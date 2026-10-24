import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getAssetsDir } from './assets.js';
import {
	RULE_PROFILES,
	findInvalidRulesProfiles,
	setUpClaudeCode,
	transformToClaudeFormat
} from './claude-code.js';

describe('setUpClaudeCode', () => {
	let projectDir: string;
	const problems: string[] = [];
	const report = (level: string, message: string) => {
		problems.push(`${level}: ${message}`);
	};
	const read = (file: string) =>
		fs.readFileSync(path.join(projectDir, file), 'utf8');

	beforeEach(() => {
		projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-project-'));
		problems.length = 0;
	});

	afterEach(() => {
		fs.rmSync(projectDir, { recursive: true, force: true });
	});

	it('copies the guide to .taskgraph/CLAUDE.md and imports it from a new CLAUDE.md', () => {
		setUpClaudeCode(projectDir, { mcp: false }, report);

		expect(read('.taskgraph/CLAUDE.md')).toBe(
			fs.readFileSync(path.join(getAssetsDir(), 'AGENTS.md'), 'utf8')
		);
		expect(read('CLAUDE.md')).toBe(
			"# Claude Code Instructions\n\n## TaskGraph Instructions\n**Import TaskGraph's development workflow commands and guidelines, treat as if import is in the main CLAUDE.md file.**\n@./.taskgraph/CLAUDE.md\n"
		);
		expect(fs.existsSync(path.join(projectDir, '.claude', 'commands'))).toBe(
			false
		);
		expect(problems).toEqual([]);
	});

	it("appends the import to the user's CLAUDE.md once", () => {
		fs.writeFileSync(path.join(projectDir, 'CLAUDE.md'), '# Mine\n\nRules\n');

		setUpClaudeCode(projectDir, { mcp: false }, report);
		const once = read('CLAUDE.md');
		setUpClaudeCode(projectDir, { mcp: false }, report);

		expect(
			once.startsWith('# Mine\n\nRules\n\n## TaskGraph Instructions')
		).toBe(true);
		expect(read('CLAUDE.md')).toBe(once);
	});

	it("removes the command files an earlier init wrote and keeps the user's own", () => {
		const tmDir = path.join(projectDir, '.claude', 'commands', 'tm');
		fs.mkdirSync(tmDir, { recursive: true });
		fs.writeFileSync(path.join(tmDir, 'next-task.md'), '# old');
		fs.writeFileSync(path.join(tmDir, 'to-review.md'), '# old');
		fs.writeFileSync(path.join(tmDir, 'my-command.md'), '# mine');

		setUpClaudeCode(projectDir, { mcp: false }, report);

		expect(fs.readdirSync(tmDir)).toEqual(['my-command.md']);
	});

	it('removes the empty .claude/commands/tm directory', () => {
		const tmDir = path.join(projectDir, '.claude', 'commands', 'tm');
		fs.mkdirSync(tmDir, { recursive: true });
		fs.writeFileSync(path.join(tmDir, 'help.md'), '# old');

		setUpClaudeCode(projectDir, { mcp: false }, report);

		expect(fs.existsSync(tmDir)).toBe(false);
	});

	it('writes no .mcp.json unless asked for, and leaves an existing one alone', () => {
		setUpClaudeCode(projectDir, { mcp: false }, report);
		expect(fs.existsSync(path.join(projectDir, '.mcp.json'))).toBe(false);

		const mine = JSON.stringify({ mcpServers: { other: { command: 'x' } } });
		fs.writeFileSync(path.join(projectDir, '.mcp.json'), mine);
		setUpClaudeCode(projectDir, { mcp: false }, report);

		expect(read('.mcp.json')).toBe(mine);
	});

	it('registers the TaskGraph MCP server in Claude format with mcp: true', () => {
		setUpClaudeCode(projectDir, { mcp: true }, report);

		expect(read('.mcp.json')).toBe(
			`${JSON.stringify(
				{
					mcpServers: {
						'taskgraph-ai': {
							type: 'stdio',
							command: 'npx',
							args: ['-y', 'taskgraph-ai'],
							env: { TASKGRAPH_TOOLS: 'core' }
						}
					}
				},
				null,
				'\t'
			)}\n`
		);
	});

	it("adds the server beside the user's and keeps a server that already launches TaskGraph", () => {
		fs.writeFileSync(
			path.join(projectDir, '.mcp.json'),
			JSON.stringify({ mcpServers: { other: { command: 'x' } } })
		);
		setUpClaudeCode(projectDir, { mcp: true }, report);
		expect(Object.keys(JSON.parse(read('.mcp.json')).mcpServers)).toEqual([
			'other',
			'taskgraph-ai'
		]);

		fs.writeFileSync(
			path.join(projectDir, '.mcp.json'),
			JSON.stringify({
				mcpServers: { tm: { command: 'npx', args: ['x', 'taskgraph-ai'] } }
			})
		);
		setUpClaudeCode(projectDir, { mcp: true }, report);
		expect(JSON.parse(read('.mcp.json')).mcpServers).toEqual({
			tm: { type: 'stdio', command: 'npx', args: ['x', 'taskgraph-ai'] }
		});
	});

	it('backs up an .mcp.json that is not valid JSON, replaces it and warns once', () => {
		fs.writeFileSync(path.join(projectDir, '.mcp.json'), '{ broken');

		setUpClaudeCode(projectDir, { mcp: true }, report);

		const backups = fs
			.readdirSync(projectDir)
			.filter((name) => name.startsWith('.mcp.json.backup-'));
		expect(backups).toHaveLength(1);
		expect(fs.readFileSync(path.join(projectDir, backups[0]), 'utf8')).toBe(
			'{ broken'
		);
		expect(Object.keys(JSON.parse(read('.mcp.json')).mcpServers)).toEqual([
			'taskgraph-ai'
		]);
		// Recovered, so a warning that names the backup, not an error (#589)
		expect(problems).toHaveLength(1);
		expect(problems[0]).toMatch(
			/^warn: Couldn't update \.mcp\.json: .+\. Saved it as \.mcp\.json\.backup-\d+ and wrote a new one$/
		);
		expect(problems[0]).toContain(backups[0]);
	});
});

describe('transformToClaudeFormat', () => {
	it('converts every server and returns {} without mcpServers', () => {
		const out = transformToClaudeFormat({
			mcpServers: { a: { command: 'x' }, b: { command: 'y', type: 'sse' } }
		});

		expect(out).toEqual({
			mcpServers: {
				a: { type: 'stdio', command: 'x' },
				b: { type: 'stdio', command: 'y' }
			}
		});
		expect(transformToClaudeFormat({})).toEqual({});
	});

	it('puts type first and keeps other server keys', () => {
		const out = transformToClaudeFormat({
			mcpServers: { tm: { env: {}, cwd: '.', args: ['x'], command: 'npx' } }
		});

		expect(Object.keys(out.mcpServers?.tm ?? {})).toEqual([
			'type',
			'command',
			'args',
			'env',
			'cwd'
		]);
	});
});

describe('rule profiles', () => {
	it('supports only the claude profile', () => {
		expect(RULE_PROFILES).toEqual(['claude']);
	});

	it('returns the unsupported names in input order', () => {
		expect(findInvalidRulesProfiles(['claude'])).toEqual([]);
		expect(findInvalidRulesProfiles(['cursor', 'claude', 'roo'])).toEqual([
			'cursor',
			'roo'
		]);
		expect(findInvalidRulesProfiles([])).toEqual([]);
	});
});

describe('assets', () => {
	it('finds the AGENTS.md guide and ships no non-Claude asset', () => {
		const dir = getAssetsDir();

		expect(fs.existsSync(path.join(dir, 'AGENTS.md'))).toBe(true);
		for (const name of ['rules', 'roocode', 'kiro-hooks', 'GEMINI.md']) {
			expect(fs.existsSync(path.join(dir, name))).toBe(false);
		}
	});
});
