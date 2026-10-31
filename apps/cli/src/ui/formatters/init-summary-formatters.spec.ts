import { describe, expect, it } from 'vitest';
import {
	type InitDryRun,
	type InitSummary,
	formatInitDryRun,
	formatInitSummary
} from './init-summary-formatters.js';

// Strip ANSI codes so assertions read like the terminal does
const plain = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '');

const fresh: InitSummary = {
	folder: 'my-app',
	changes: [
		{ path: '.taskgraph/', note: 'tasks, settings and PRD templates' },
		{ path: '.gitignore', note: 'created' }
	],
	alreadySetUp: false,
	claudeCode: false
};

describe('formatInitSummary', () => {
	it('lists what it created with the paths aligned', () => {
		const lines = plain(formatInitSummary(fresh)).split('\n');

		expect(lines.slice(0, 3)).toEqual([
			'✓ Set up TaskGraph in my-app',
			'  .taskgraph/  tasks, settings and PRD templates',
			'  .gitignore   created'
		]);
	});

	it('leads with one next step to a first task, not a numbered list', () => {
		const text = plain(formatInitSummary(fresh));

		expect(text).toContain(
			"Next: taskgraph add-task --prompt='<what to do>', or taskgraph parse-prd <file>"
		);
		expect(text).not.toContain('Next steps');
		expect(text).not.toMatch(/^\s*\d\. /m);
		for (const line of text.split('\n')) expect(line.length).toBeLessThan(80);
	});

	it('says AI runs through Claude Code and never asks for API keys', () => {
		const text = plain(formatInitSummary(fresh));

		expect(text).toContain('run claude once to sign in');
		expect(text).not.toMatch(/api key/i);
	});

	it('says how to change the default models and language', () => {
		const text = plain(formatInitSummary(fresh));

		expect(text).toContain(
			'Change the models or language with taskgraph models --setup or taskgraph lang'
		);
	});

	it('keeps the plugin install hint when Claude Code was set up', () => {
		const lines = plain(
			formatInitSummary({ ...fresh, claudeCode: true })
		).split('\n');
		const next = lines.findIndex((line) => line.startsWith('Next: '));

		expect(lines.slice(next + 1, next + 4)).toEqual([
			'Add the slash commands in Claude Code:',
			'  /plugin marketplace add stephennmiller/taskgraph-ai',
			'  /plugin install taskgraph@taskgraph'
		]);
	});

	it('shows only the plugin hint on a re-run with Claude Code', () => {
		const text = plain(
			formatInitSummary({
				...fresh,
				alreadySetUp: true,
				changes: [],
				claudeCode: true
			})
		);

		expect(text).toContain('/plugin install taskgraph@taskgraph');
		expect(text).not.toContain('Next:');
	});

	it('says so when the folder was already set up and nothing changed', () => {
		const text = plain(
			formatInitSummary({ ...fresh, alreadySetUp: true, changes: [] })
		);

		expect(text.split('\n')).toEqual([
			'✓ TaskGraph is already set up in my-app',
			'  Run taskgraph list to see your tasks'
		]);
	});

	it('lists only what was added to an existing project', () => {
		const text = plain(
			formatInitSummary({
				...fresh,
				alreadySetUp: true,
				changes: [{ path: '.taskgraph/config.json', note: 'restored' }]
			})
		);

		expect(text.split('\n')).toEqual([
			'✓ Updated TaskGraph in my-app',
			'  .taskgraph/config.json  restored'
		]);
	});

	it('keeps "already set up" when the only row is a hint', () => {
		const text = plain(
			formatInitSummary({
				...fresh,
				alreadySetUp: true,
				changes: [],
				hints: [
					{
						path: '.taskgraph/state.json',
						note: 'ignored but still tracked; `git rm --cached` it'
					}
				]
			})
		);

		expect(text.split('\n')).toEqual([
			'✓ TaskGraph is already set up in my-app',
			'  .taskgraph/state.json  ignored but still tracked; git rm --cached it'
		]);
	});

	it('lists hints after the changes, aligned with them', () => {
		const text = plain(
			formatInitSummary({
				...fresh,
				alreadySetUp: true,
				changes: [{ path: '.gitignore', note: 'added TaskGraph entries' }],
				hints: [{ path: '.taskgraph/state.json', note: 'still tracked' }]
			})
		);

		expect(text.split('\n')).toEqual([
			'✓ Updated TaskGraph in my-app',
			'  .gitignore             added TaskGraph entries',
			'  .taskgraph/state.json  still tracked'
		]);
	});
});

describe('formatInitDryRun', () => {
	const plan: InitDryRun = {
		startGit: false,
		mergeDriver: false,
		storeTasksInGit: false,
		aliasFile: null,
		claudeCode: false,
		mcp: false
	};

	it('lists only the steps that would run', () => {
		expect(formatInitDryRun(plan)).toBe(
			[
				'Dry run; nothing was changed. Init would:',
				'  create .taskgraph/ with tasks, settings and PRD templates',
				'  create or update .gitignore and .env.example',
				'  keep tasks out of Git'
			].join('\n')
		);
	});

	it('lists every step, each within 80 columns', () => {
		const text = formatInitDryRun({
			importFrom: '.upstream',
			startGit: true,
			mergeDriver: true,
			storeTasksInGit: true,
			aliasFile: '~/.zshrc',
			claudeCode: true,
			mcp: true
		});

		expect(text.split('\n').slice(1)).toEqual([
			'  create .taskgraph/ with tasks, settings and PRD templates',
			'  import tasks, docs, reports and settings from .upstream/',
			'  create or update .gitignore and .env.example',
			'  start a Git repository',
			'  set up Git to merge tasks.json by task (.gitattributes)',
			'  keep tasks in Git',
			'  add the tm alias to ~/.zshrc',
			'  import TaskGraph’s guide in CLAUDE.md and add the MCP server to .mcp.json'
		]);
		for (const line of text.split('\n')) expect(line.length).toBeLessThan(80);
	});

	it('strips escape codes from the alias path', () => {
		expect(
			formatInitDryRun({ ...plan, aliasFile: '~/\u001b[31m.zshrc' })
		).not.toContain('\u001b');
	});
});
