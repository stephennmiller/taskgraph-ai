/**
 * Set up the fake `claude` program (fake-claude.mjs) for a TaskGraph project.
 *
 * TaskGraph reads `claudeCode.pathToClaudeCodeExecutable` from the project
 * config, but only runs it if it is an absolute path to a file named `claude`
 * outside the project. So the shim goes in a separate work directory.
 *
 * The returned `env` must be set on the process that runs the CLI or MCP
 * server. It also blanks the credentials and points Claude's config at the
 * work directory, so a setting the app rejects cannot quietly fall back to a
 * real, signed-in Claude Code. Tests should still check the trace grew.
 */

import fs from 'node:fs';
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

	const executable = path.join(binDir, 'claude');
	writeFileAtomic(
		executable,
		`#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(fakeClaude)} "$@"\n`,
		{ mode: 0o755 }
	);
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
