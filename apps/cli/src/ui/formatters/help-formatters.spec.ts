import { describe, expect, it } from 'vitest';
import { HELP_GROUPS, formatHelp } from './help-formatters.js';

const stripAnsi = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');

// Every command the help screen may list. Commands are registered in two
// places (commands.js and registerAllCommands), so there is no registry to
// read; a new row has to be added here on purpose.
const ALLOWED_COMMANDS = new Set([
	'next',
	'show',
	'list',
	'set-status',
	'add-task',
	'init',
	'models',
	'completion',
	'parse-prd',
	'generate',
	'update',
	'update-task',
	'update-subtask',
	'remove-task',
	'add-subtask',
	'remove-subtask',
	'clear-subtasks',
	'sync-readme',
	'analyze-complexity',
	'complexity-report',
	'expand',
	'research',
	'graph',
	'why',
	'archive',
	'tags',
	'add-dependency',
	'remove-dependency',
	'validate-dependencies',
	'fix-dependencies'
]);

const allRows = () => HELP_GROUPS.flatMap((group) => group.commands);

describe('formatHelp', () => {
	it('starts with the Daily workflow group and its five commands', () => {
		const [first] = HELP_GROUPS;

		expect(first.title).toBe('Daily workflow');
		expect(first.commands.map((c) => c.name)).toEqual([
			'next',
			'show',
			'list',
			'set-status',
			'add-task'
		]);
	});

	it('lists at most 30 rows with no repeated command', () => {
		const names = allRows().map((row) => row.name.split(' ')[0]);

		expect(names.length).toBeLessThanOrEqual(30);
		expect(new Set(names).size).toBe(names.length);
	});

	it('lists why right after graph in Organize', () => {
		const organize = HELP_GROUPS.find((g) => g.title === 'Organize');
		const names = organize?.commands.map((c) => c.name) ?? [];

		expect(names.indexOf('why')).toBe(names.indexOf('graph') + 1);
	});

	it('only lists commands from the static allowlist', () => {
		for (const row of allRows()) {
			expect(ALLOWED_COMMANDS.has(row.name.split(' ')[0])).toBe(true);
		}
	});

	it('keeps prime, an agent command, out of the groups', () => {
		expect(allRows().some((row) => row.name.startsWith('prime'))).toBe(false);
	});

	it('keeps a tags subcommand hint on the tags row', () => {
		const tags = allRows().find((row) => row.name.startsWith('tags'));

		expect(tags?.name).toBe('tags <add|use|remove|rename|copy>');
	});

	it.each([60, 80, 120])('does not overflow at %i columns', (width) => {
		const lines = stripAnsi(formatHelp(width)).split('\n');

		for (const line of lines) {
			expect(line.length).toBeLessThanOrEqual(width);
		}
	});

	it('cuts no description at 80 columns', () => {
		expect(stripAnsi(formatHelp(80))).not.toContain('…');
	});

	it('shows the group titles in order, then the footer', () => {
		const text = stripAnsi(formatHelp(80));
		const positions = HELP_GROUPS.map((g) => text.indexOf(g.title));

		expect(positions.every((p) => p >= 0)).toBe(true);
		expect([...positions].sort((a, b) => a - b)).toEqual(positions);
		expect(text).toContain('taskgraph <command> --help');
		expect(text).toContain('works on its own');
		expect(text).toContain('Agents: taskgraph prime');
		expect(text).toContain(
			'/plugin marketplace add stephennmiller/taskgraph-ai'
		);
		expect(text).toContain('/plugin install taskgraph@taskgraph');
	});
});
