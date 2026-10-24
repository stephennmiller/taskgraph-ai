/**
 * Set up the fake `claude` program (fake-claude.mjs) for a TaskGraph project.
 *
 * TaskGraph reads `claudeCode.pathToClaudeCodeExecutable` from the project
 * config, but only runs it if it is an absolute path to a file named `claude`
 * (or `claude.exe`) outside the project. So the shim goes in a separate work
 * directory. On Windows the shim is a small compiled `claude.exe`: the Agent
 * SDK spawns the path without a shell, which can run neither a shell script
 * nor a `.cmd` (#524).
 *
 * The returned `env` must be set on the process that runs the CLI or MCP
 * server. It also blanks the credentials and points Claude's config at the
 * work directory, so a setting the app rejects cannot quietly fall back to a
 * real, signed-in Claude Code. Tests should still check the trace grew.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fakeClaude = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'fake-claude.mjs'
);

const shellQuote = (text) => `'${text.replaceAll("'", `'\\''`)}'`;

/** Write a file so readers see the old content or the new, never half. */
function writeFileAtomic(file, content, options) {
	const temp = `${file}.${process.pid}.tmp`;
	fs.writeFileSync(temp, content, options);
	fs.renameSync(temp, file);
}

/**
 * A claude.exe that runs `node fake-claude.mjs` with the arguments it got.
 * It passes its own command line on unparsed, so node splits the arguments
 * exactly as the SDK quoted them. Compiled once with the C# compiler that
 * ships with Windows and cached in the temp directory.
 * @returns {string} Path of the cached launcher
 */
function windowsLauncher() {
	const literal = (text) => `@"${text.replaceAll('"', '""')}"`;
	const source = `using System.Diagnostics;
static class FakeClaude {
	static int Main() {
		string line = System.Environment.CommandLine;
		int end = line.StartsWith("\\"") ? line.IndexOf('"', 1) + 1 : line.IndexOf(' ');
		string rest = end <= 0 ? "" : line.Substring(end);
		var info = new ProcessStartInfo(${literal(process.execPath)}, ${literal(`"${fakeClaude}"`)} + rest) { UseShellExecute = false };
		using (var child = Process.Start(info)) { child.WaitForExit(); return child.ExitCode; }
	}
}
`;
	const hash = createHash('sha256').update(source).digest('hex').slice(0, 16);
	const exe = path.join(os.tmpdir(), `fake-claude-${hash}.exe`);
	if (fs.existsSync(exe)) return exe;

	const temp = `${exe}.${process.pid}`;
	fs.writeFileSync(`${temp}.cs`, source);
	const csc = path.join(
		process.env.WINDIR ?? 'C:\\Windows',
		'Microsoft.NET',
		'Framework64',
		'v4.0.30319',
		'csc.exe'
	);
	execFileSync(csc, ['/nologo', `/out:${temp}.exe`, `${temp}.cs`]);
	fs.rmSync(`${temp}.cs`);
	try {
		fs.renameSync(`${temp}.exe`, exe);
	} catch (error) {
		// Another test process cached the same launcher first
		if (!fs.existsSync(exe)) throw error;
		fs.rmSync(`${temp}.exe`, { force: true });
	}
	return exe;
}

/**
 * @param {object} options
 * @param {string} options.projectDir Project with an initialized .taskgraph/
 * @param {string} options.workDir Directory outside the project for the shim and trace
 * @param {object[]} [options.replies] Canned replies, in call order
 * @returns {{executable: string, dir: string, env: Record<string, string>}}
 */
export function installFakeClaude({ projectDir, workDir, replies }) {
	const configPath = path.join(projectDir, '.taskgraph', 'config.json');
	if (!fs.existsSync(configPath)) {
		throw new Error(
			`${configPath} not found; run taskgraph init in the project first`
		);
	}

	const binDir = path.join(workDir, 'bin');
	const dir = path.join(workDir, 'fake-claude');
	const claudeHome = path.join(workDir, 'claude-home');
	for (const d of [binDir, dir, claudeHome])
		fs.mkdirSync(d, { recursive: true });

	// An earlier install in the same work dir must not leak calls or replies
	for (const name of fs.readdirSync(dir)) {
		if (/^(call-\d+|trace\.jsonl|replies\.json)$/.test(name)) {
			fs.rmSync(path.join(dir, name));
		}
	}

	let executable;
	if (process.platform === 'win32') {
		executable = path.join(binDir, 'claude.exe');
		fs.copyFileSync(windowsLauncher(), executable);
	} else {
		executable = path.join(binDir, 'claude');
		writeFileAtomic(
			executable,
			`#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(fakeClaude)} "$@"\n`,
			{ mode: 0o755 }
		);
	}
	if (replies) {
		writeFileAtomic(path.join(dir, 'replies.json'), JSON.stringify(replies));
	}

	const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
	config.claudeCode = {
		...config.claudeCode,
		pathToClaudeCodeExecutable: executable
	};
	writeFileAtomic(configPath, JSON.stringify(config, null, 2));

	return {
		executable,
		dir,
		env: {
			FAKE_CLAUDE_DIR: dir,
			ANTHROPIC_API_KEY: '',
			CLAUDE_CODE_API_KEY: '',
			CLAUDE_CODE_OAUTH_TOKEN: '',
			CLAUDE_CONFIG_DIR: claudeHome
		}
	};
}

/**
 * @param {string} dir The `dir` returned by installFakeClaude
 * @returns {Array<{n: number, args: string[], schema: object|null, prompt: string, initialize: object|null}>}
 *   In call order.
 */
export function readTrace(dir) {
	let text;
	try {
		text = fs.readFileSync(path.join(dir, 'trace.jsonl'), 'utf8');
	} catch (error) {
		if (error.code === 'ENOENT') return [];
		throw error;
	}
	return text
		.split('\n')
		.filter(Boolean)
		.map((line) => JSON.parse(line))
		.sort((a, b) => a.n - b.n);
}
