/**
 * @fileoverview The `taskgraph --help` screen, e.g.
 *
 *   TaskGraph  AI task management for your coding agent
 *
 *   Daily workflow
 *     next                              Show the next task to work on
 *     show                              Show one task in detail
 *
 *   Run taskgraph <command> --help for a command's flags
 *   Agents: taskgraph prime prints task context and rules
 *
 * It replaces 8 boxed categories and 42 rows (3 for `list`, 5 for `models`)
 * whose columns added up to 110 and overflowed 80 columns. Flags live in
 * `taskgraph <command> --help`; this screen only says what each command is for.
 */

import chalk from 'chalk';
import { terminalWidth } from '../layout/helpers.js';
import { theme } from '../theme.js';
import { PLUGIN_MARKETPLACE, PLUGIN_NAME } from './init-summary-formatters.js';

export interface HelpRow {
	/** The command, plus a short hint for subcommands (`tags <add|use|…>`) */
	name: string;
	desc: string;
}

export interface HelpGroup {
	title: string;
	commands: readonly HelpRow[];
}

/**
 * One row per command, in the order a user reaches for them. Commands are
 * registered in two places (commands.js and registerAllCommands), so this list
 * is static rather than read from a registry.
 */
export const HELP_GROUPS: readonly HelpGroup[] = [
	{
		title: 'Daily workflow',
		commands: [
			{ name: 'next', desc: 'Show the next task to work on' },
			{ name: 'show', desc: 'Show one task in detail' },
			{ name: 'list', desc: 'List tasks, filtered by status or tag' },
			{ name: 'set-status', desc: 'Change a task or subtask status' },
			{ name: 'add-task', desc: 'Add a task from a description' }
		]
	},
	{
		title: 'Setup',
		commands: [
			{ name: 'init', desc: 'Set up TaskGraph in this project' },
			{ name: 'models', desc: 'View or change the AI models' },
			{ name: 'completion', desc: 'Install Tab completion for your shell' }
		]
	},
	{
		title: 'Create & update',
		commands: [
			{ name: 'parse-prd', desc: 'Generate tasks from a PRD' },
			{ name: 'generate', desc: 'Write a file for each task' },
			{ name: 'update', desc: 'Update tasks from an ID onwards' },
			{ name: 'update-task', desc: 'Update one task' },
			{ name: 'note', desc: 'Log a progress note on a task, as written' },
			{ name: 'add-subtask', desc: 'Add a subtask, or make a task one' },
			{ name: 'remove-task', desc: 'Remove a task or subtask' },
			{ name: 'remove-subtask', desc: 'Remove a subtask' },
			{ name: 'clear-subtasks', desc: 'Remove all subtasks from tasks' },
			{ name: 'sync-readme', desc: 'Export tasks to README.md' }
		]
	},
	{
		title: 'Analyze & expand',
		commands: [
			{ name: 'analyze-complexity', desc: 'Score tasks for complexity' },
			{ name: 'complexity-report', desc: 'Show the complexity report' },
			{ name: 'expand', desc: 'Break a task into subtasks' },
			{ name: 'research', desc: 'Ask a research question about the project' }
		]
	},
	{
		title: 'Organize',
		commands: [
			{
				name: 'tags <add|use|remove|rename|copy>',
				desc: 'List or manage tags'
			},
			{ name: 'graph', desc: 'Show tasks as a dependency tree' },
			{ name: 'why', desc: 'Explain why a task is blocked' },
			{
				name: 'archive <restore>',
				desc: 'Move finished tasks out, or restore one'
			},
			{ name: 'add-dependency', desc: 'Make a task depend on another' },
			{ name: 'remove-dependency', desc: 'Remove a dependency' },
			{ name: 'validate-dependencies', desc: 'Report invalid dependencies' },
			{ name: 'fix-dependencies', desc: 'Fix invalid dependencies' }
		]
	}
];

const INDENT = '  ';
const GAP = '  ';

const fit = (text: string, width: number) =>
	text.length > width ? `${text.slice(0, Math.max(1, width - 1))}…` : text;

/**
 * Format the help screen.
 *
 * @param width - Terminal width; descriptions are cut to fit on one line
 */
export function formatHelp(width = terminalWidth()): string {
	const rows = HELP_GROUPS.flatMap((group) => group.commands);
	const nameWidth = Math.max(...rows.map((row) => row.name.length));
	const descWidth = Math.max(
		10,
		width - INDENT.length * 2 - nameWidth - GAP.length
	);

	const lines = [
		`${chalk.bold('TaskGraph')}  ${theme.muted('AI task management for your coding agent')}`
	];

	for (const group of HELP_GROUPS) {
		lines.push('', theme.heading(group.title));
		for (const row of group.commands) {
			lines.push(
				`${INDENT}${theme.brand(row.name.padEnd(nameWidth))}${GAP}${theme.muted(fit(row.desc, descWidth))}`
			);
		}
	}

	lines.push(
		'',
		theme.muted('Run ') +
			theme.brand('taskgraph <command> --help') +
			theme.muted(' for a command’s flags'),
		// `prime` is for agents, not people, so it stays out of the groups (#195)
		theme.muted('Agents: ') +
			theme.brand('taskgraph prime') +
			theme.muted(' prints task context and rules'),
		theme.muted('The CLI works on its own. For Claude Code slash commands:'),
		`${INDENT}${theme.brand(`/plugin marketplace add ${PLUGIN_MARKETPLACE}`)}`,
		`${INDENT}${theme.brand(`/plugin install ${PLUGIN_NAME}`)}`
	);

	return lines.join('\n');
}
