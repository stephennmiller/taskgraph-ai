/**
 * Fixtures shared by the plugin hook tests: fake `taskgraph` CLIs, TaskGraph
 * projects in temp folders, and a runner that feeds a hook Claude Code's JSON.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../../../..'
);
export const pluginDir = path.join(rootDir, 'packages/claude-code-plugin');
export const config = JSON.parse(
	fs.readFileSync(path.join(pluginDir, 'hooks/hooks.json'), 'utf8')
);

export const sessionStart = path.join(pluginDir, 'hooks/session-start.sh');
export const stop = path.join(pluginDir, 'hooks/stop.sh');
export const promptSubmit = path.join(pluginDir, 'hooks/prompt-submit.sh');

const tempDirs: string[] = [];
export const tempDir = (prefix: string) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
};

/** A bin directory holding a fake `taskgraph` with the given script body */
export function fakeCli(body: string): string {
	const bin = tempDir('tg-hook-bin-');
	const file = path.join(bin, 'taskgraph');
	fs.writeFileSync(file, `#!/bin/sh\n${body}\n`);
	fs.chmodSync(file, 0o755);
	return bin;
}

/** Only the system tools the hooks use, so a global taskgraph stays off PATH */
export const systemBin = (() => {
	const bin = tempDir('tg-hook-sys-');
	for (const tool of ['cat', 'date', 'grep', 'id', 'mkdir', 'sh']) {
		const found = ['/usr/bin', '/bin']
			.map((dir) => path.join(dir, tool))
			.find((file) => fs.existsSync(file));
		if (found) fs.symlinkSync(found, path.join(bin, tool));
	}
	return bin;
})();

/** The private folder the hooks keep session markers in, under `tmp` */
export const markerDir = (tmp: string) =>
	path.join(tmp, `taskgraph-${process.getuid?.() ?? ''}`);

/** A TaskGraph project, i.e. one with the config.json `init` writes */
export function project(prefix: string): string {
	const dir = tempDir(prefix);
	fs.mkdirSync(path.join(dir, '.taskgraph'));
	fs.writeFileSync(path.join(dir, '.taskgraph/config.json'), '{}');
	return dir;
}

interface HookRun {
	/** The JSON Claude Code sends on stdin */
	input?: string;
	/** Where the session marker goes */
	tmp?: string;
	/** Run with this shell instead of bash */
	shell?: string;
	/** Extra environment variables */
	env?: Record<string, string>;
}

export function runHook(
	script: string,
	projectDir: string,
	binDir: string,
	options: HookRun = {}
) {
	return spawnSync(options.shell ?? '/bin/bash', [script], {
		cwd: projectDir,
		encoding: 'utf8',
		input: options.input ?? '',
		env: {
			PATH: `${binDir}:${systemBin}`,
			CLAUDE_PROJECT_DIR: projectDir,
			...(options.tmp ? { TMPDIR: options.tmp } : {}),
			...options.env
		}
	});
}

/** A project whose tasks.json has a task with the given status */
export function projectWithTask(prefix: string, status: string): string {
	const dir = project(prefix);
	fs.mkdirSync(path.join(dir, '.taskgraph/tasks'));
	fs.writeFileSync(
		path.join(dir, '.taskgraph/tasks/tasks.json'),
		JSON.stringify({ master: { tasks: [{ id: 1, status }] } }, null, 2)
	);
	return dir;
}

/** Compact JSON, as Claude Code sends it */
export const hookInput = (fields: Record<string, unknown>) =>
	JSON.stringify({ session_id: 'abc-123', cwd: '/x', ...fields });

/** Removes the temp folders made so far; each test file calls it afterAll */
export function removeTempDirs(): void {
	for (const dir of tempDirs.splice(0)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}
