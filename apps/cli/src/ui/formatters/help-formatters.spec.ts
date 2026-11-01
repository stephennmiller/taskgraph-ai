import { describe, expect, it } from 'vitest';
import { HELP_GROUPS, formatHelp } from './help-formatters.js';

const stripAnsi = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');

// Every command the help screen may list. Commands are registered in two
// places (program.ts and registerAllCommands), so there is no registry to
// read; a new row has to be added here on purpose.
const ALLOWED_COMMANDS = new Set([
	'next',
	'show',
	'list',
	'set-status',
	'add-task',
	'loop',
	'init',
	'doctor',
	'upgrade',
	'models',
	'lang',
	'completion',
	'parse-prd',
	'generate',
	'update',
	'note',
	'remove-task',
	'add-subtask',
	'clear-subtasks',
	'sync-readme',
	'github',
	'analyze-complexity',
	'expand',
	'scope',
	'research',
	'graph',
	'why',
	'move',
	'archive',
	'tags',
	'depend',
	'fix-dependencies'
]);

const allRows = () => HELP_GROUPS.flatMap((group) => group.commands);
// The command each row names, without its subcommand hint
const rowNames = () => allRows().map((row) => row.name.split(' ')[0]);

describe('formatHelp', () => {
	it('starts with the Daily workflow group, ending with loop', () => {
		const [first] = HELP_GROUPS;

		expect(first.title).toBe('Daily workflow');
		expect(first.commands.map((c) => c.name)).toEqual([
			'next',
			'show',
			'list',
			'set-status',
			'add-task',
			'loop'
		]);
	});

	// 30 rows left out loop, move, lang, scope-up, scope-down and github
	// (#219). Each command a user runs now has one row, so the cap is the
	// command count; raise it only for a new command, not a second row.
	// 37 with doctor (#256). 38 with upgrade (#696). 35 once remove-subtask
	// and the dependency commands merged, 32 once update-task,
	// complexity-report and scope-up / scope-down merged (#882).
	it('lists at most 32 rows with no repeated command', () => {
		const names = rowNames();

		expect(names.length).toBeLessThanOrEqual(32);
		expect(new Set(names).size).toBe(names.length);
	});

	it('lists why right after graph in Organize', () => {
		const organize = HELP_GROUPS.find((g) => g.title === 'Organize');
		const names = organize?.commands.map((c) => c.name) ?? [];

		expect(names.indexOf('why')).toBe(names.indexOf('graph') + 1);
	});

	it('only lists commands from the static allowlist', () => {
		for (const name of rowNames()) {
			expect(ALLOWED_COMMANDS.has(name)).toBe(true);
		}
	});

	it('keeps prime, an agent command, out of the groups', () => {
		expect(allRows().some((row) => row.name.startsWith('prime'))).toBe(false);
	});

	it.each(['loop', 'move', 'lang', 'scope', 'github'])(
		'lists %s, which the help used to leave out',
		(command) => {
			expect(rowNames()).toContain(command);
		}
	);

	it.each([
		'merge-driver',
		'update-task',
		'complexity-report',
		'scope-up',
		'scope-down',
		'remove-subtask',
		'add-dependency',
		'remove-dependency',
		'validate-dependencies'
	])('gives %s no row', (command) => {
		expect(rowNames()).not.toContain(command);
	});

	it('keeps a github subcommand hint on the github row', () => {
		const github = allRows().find((row) => row.name.startsWith('github'));

		expect(github?.name).toBe('github <push|pull|status|unlink>');
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
