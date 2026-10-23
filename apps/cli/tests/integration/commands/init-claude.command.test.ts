/**
 * @fileoverview `init` sets up the Claude Code integration by default (also
 * under --yes), writes .mcp.json only with --mcp, and never edits the shell
 * startup file for MCP. Run against the built CLI.
 *
 * @integration
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getCliBinPath } from '../../helpers/test-utils.js';

describe('init and the Claude Code integration', () => {
	let dir: string;
	let home: string;

	const init = (...args: string[]) =>
		spawnSync(
			'node',
			[getCliBinPath(), 'init', '--yes', '--no-git', '--no-aliases', ...args],
			{
				cwd: dir,
				encoding: 'utf8',
				input: '',
				timeout: 60000,
				env: {
					...process.env,
					HOME: home,
					SHELL: '/bin/bash',
					FORCE_COLOR: '0',
					COLUMNS: '80',
					TASKGRAPH_SKIP_AUTO_UPDATE: '1'
				}
			}
		);
	const exists = (file: string) => fs.existsSync(path.join(dir, file));

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-init-claude-'));
		home = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-init-claude-home-'));
		fs.writeFileSync(path.join(home, '.bashrc'), '# mine\n');
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
		fs.rmSync(home, { recursive: true, force: true });
	});

	it('sets up Claude Code under --yes, without .mcp.json or a shell rc edit', () => {
		const result = init();

		expect(result.status).toBe(0);
		expect(exists('.taskgraph/CLAUDE.md')).toBe(true);
		expect(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8')).toContain(
			'@./.taskgraph/CLAUDE.md'
		);
		expect(exists('.mcp.json')).toBe(false);
		expect(fs.readFileSync(path.join(home, '.bashrc'), 'utf8')).toBe(
			'# mine\n'
		);
		expect(result.stdout).toContain('/plugin install taskgraph@taskgraph');
		expect(result.stdout).not.toContain('.mcp.json');
	});

	it('--no-claude skips it', () => {
		const result = init('--no-claude');

		expect(result.status).toBe(0);
		expect(exists('.taskgraph/config.json')).toBe(true);
		expect(exists('CLAUDE.md')).toBe(false);
		expect(exists('.taskgraph/CLAUDE.md')).toBe(false);
		expect(result.stdout).not.toContain('/plugin install');
	});

	it('--mcp also registers the MCP server in .mcp.json', () => {
		const result = init('--mcp');

		expect(result.status).toBe(0);
		const config = JSON.parse(
			fs.readFileSync(path.join(dir, '.mcp.json'), 'utf8')
		);
		expect(Object.values(config.mcpServers)).toEqual([
			expect.objectContaining({ type: 'stdio' })
		]);
		expect(result.stdout).toContain('.mcp.json');
		expect(fs.readFileSync(path.join(home, '.bashrc'), 'utf8')).toBe(
			'# mine\n'
		);
	});

	it('--mcp with --no-claude exits 1 with a fix and changes nothing', () => {
		const result = init('--mcp', '--no-claude');

		expect(result.status).toBe(1);
		expect(result.stderr).toContain('--mcp');
		expect(result.stderr).toContain('Drop --no-claude, or drop --mcp');
		expect(fs.readdirSync(dir)).toEqual([]);
	});

	it('--dry-run says it would set up Claude Code', () => {
		expect(init('--dry-run').stdout).toContain(
			'import TaskGraph’s guide in CLAUDE.md'
		);
		expect(init('--dry-run', '--no-claude').stdout).not.toContain('CLAUDE.md');
	});
});
