/**
 * Run ripgrep the way Claude Code's Grep tool does, for path guard tests.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../../../../../..'
);

/**
 * The ripgrep Claude Code's Grep runs: the Claude Code binary acts as rg when
 * started with argv0 `rg`. Falls back to rg on PATH.
 */
function findRipgrep() {
	const exe = process.platform === 'win32' ? 'claude.exe' : 'claude';
	const platform = `${process.platform}-${process.arch}`;
	for (const pkg of [
		`claude-agent-sdk-${platform}`,
		`claude-code-${platform}`
	]) {
		const bin = path.join(repoRoot, 'node_modules/@anthropic-ai', pkg, exe);
		if (fs.existsSync(bin)) return { command: bin, args: ['--no-config'] };
	}
	const probe = spawnSync('rg', ['--version']);
	return probe.status === 0 ? { command: 'rg', args: [] } : null;
}

/**
 * The rg arguments Claude Code (2.1.x) builds for a Grep call in content
 * mode: --hidden, then each `glob` token as --glob. Tokens split on spaces,
 * then on commas unless the token holds a brace group.
 */
/** A Grep call's input */
type GrepInput = Record<string, any>;

function grepArgs({ pattern, glob, type, path: searchPath }: GrepInput) {
	const args = ['--hidden', '--no-heading', '-n'];
	for (const token of (glob ?? '').split(/\s+/).filter(Boolean)) {
		const parts =
			token.includes('{') && token.includes('}') ? [token] : token.split(',');
		for (const part of parts.filter(Boolean)) args.push('--glob', part);
	}
	if (type) args.push('--type', type);
	// rg reads stdin when given no path, so name the directory like Claude Code
	args.push('-e', pattern, searchPath ?? '.');
	return args;
}

export const ripgrep = findRipgrep();

/** Lines a Grep call returns when run from cwd */
export function runGrep(cwd: string, input: GrepInput): string[] {
	if (!ripgrep) throw new Error('ripgrep is not installed');
	const result = spawnSync(
		ripgrep.command,
		[...ripgrep.args, ...grepArgs(input)],
		{ cwd, argv0: 'rg', encoding: 'utf8' }
	);
	if (result.status !== 0 && result.status !== 1) {
		throw new Error(`ripgrep failed: ${result.stderr || result.error}`);
	}
	return result.stdout.split('\n').filter(Boolean).sort();
}
