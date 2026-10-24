/**
 * @fileoverview What `taskgraph init` did and what to do next, e.g.
 *
 *   ✓ Set up TaskGraph in my-app
 *     .taskgraph/    tasks, settings and PRD templates
 *     .gitignore     added TaskGraph entries
 *
 *   Next steps
 *     1. Write a PRD in .taskgraph/docs/prd.md
 *        Templates are in .taskgraph/templates/
 *     2. Turn it into tasks: taskgraph parse-prd
 *     3. Start the first task: taskgraph next
 *
 * It replaces a line per directory and file created (with absolute paths),
 * a "Success!" banner and a seven-step workflow box.
 */

import chalk from 'chalk';
import { theme, withCode } from '../theme.js';
import { terminalSafe } from './markdown-formatters.js';

/** One file or folder that init created or changed */
export interface InitChange {
	/** Path as the user would type it, e.g. `.gitignore` or `~/.zshrc` */
	path: string;
	/** What happened to it, e.g. "created" */
	note: string;
}

export interface InitSummary {
	/** Name of the project folder */
	folder: string;
	/** Files and folders created or changed, in order */
	changes: InitChange[];
	/**
	 * Rows about files init left alone but the user should act on, listed
	 * after the changes. They don't count as changes in the headline.
	 */
	hints?: InitChange[];
	/** The folder was already a TaskGraph project before this run */
	alreadySetUp: boolean;
	/** The Claude Code integration was installed in this run */
	claudeCode: boolean;
	/** Model setup was skipped, so the defaults are in use */
	defaultModels: boolean;
}

/** The marketplace and plugin names from .claude-plugin/marketplace.json */
export const PLUGIN_MARKETPLACE = 'stephennmiller/taskgraph-ai';
export const PLUGIN_NAME = 'taskgraph@taskgraph';

const PRD_PATH = '.taskgraph/docs/prd.md';
const TEMPLATES_DIR = '.taskgraph/templates/';

function formatChanges(changes: InitChange[]): string[] {
	const width = Math.max(0, ...changes.map((change) => change.path.length));
	return changes.map(
		(change) =>
			`  ${change.path.padEnd(width)}  ${theme.muted(withCode(change.note))}`
	);
}

function nextSteps(summary: InitSummary): string[][] {
	const steps: string[][] = [];
	if (summary.claudeCode) {
		steps.push([
			'Add the slash commands in Claude Code:',
			theme.brand(`/plugin marketplace add ${PLUGIN_MARKETPLACE}`),
			theme.brand(`/plugin install ${PLUGIN_NAME}`)
		]);
	}
	if (!summary.alreadySetUp) {
		steps.push(
			[
				`Write a PRD in ${PRD_PATH}`,
				theme.muted(`Templates are in ${TEMPLATES_DIR}`)
			],
			[`Turn it into tasks: ${theme.brand('taskgraph parse-prd')}`],
			[`Start the first task: ${theme.brand('taskgraph next')}`]
		);
	}
	return steps;
}

/**
 * Format the summary printed at the end of `taskgraph init`.
 */
export function formatInitSummary(summary: InitSummary): string {
	const check = chalk.green('✓');
	const lines: string[] = [];

	if (!summary.alreadySetUp) {
		lines.push(`${check} Set up TaskGraph in ${summary.folder}`);
	} else if (summary.changes.length > 0) {
		lines.push(`${check} Updated TaskGraph in ${summary.folder}`);
	} else {
		lines.push(`${check} TaskGraph is already set up in ${summary.folder}`);
		// A hint row is the next step; otherwise point at the tasks
		if (!summary.hints?.length) {
			lines.push(
				theme.muted(withCode('  Run `taskgraph list` to see your tasks'))
			);
		}
	}
	lines.push(...formatChanges([...summary.changes, ...(summary.hints ?? [])]));

	const steps = nextSteps(summary);
	if (steps.length > 0) {
		lines.push('', theme.heading('Next steps'));
		steps.forEach(([first, ...rest], index) => {
			const number = `${index + 1}. `;
			lines.push(`  ${number}${first}`);
			for (const line of rest) {
				lines.push(`  ${' '.repeat(number.length)}${line}`);
			}
		});
	}

	if (!summary.alreadySetUp) {
		lines.push(
			'',
			theme.muted(
				withCode('AI runs through Claude Code; run `claude` once to sign in')
			)
		);
		if (summary.defaultModels) {
			lines.push(
				theme.muted(
					withCode(
						'Using the default models; change them with `taskgraph models --setup`'
					)
				)
			);
		}
	}

	return lines.join('\n');
}

/** What `taskgraph init --dry-run` would do */
export interface InitDryRun {
	/** The upstream folder an import would read (UPSTREAM_DIR) */
	importFrom?: string;
	startGit: boolean;
	mergeDriver: boolean;
	storeTasksInGit: boolean;
	/** The shell startup file the `tm` alias would go in, as shown */
	aliasFile: string | null;
	claudeCode: boolean;
	mcp: boolean;
}

/**
 * Say what init would do without doing it, e.g.
 *
 *   Dry run; nothing was changed. Init would:
 *     create .taskgraph/ with tasks, settings and PRD templates
 *     create or update .gitignore and .env.example
 *     keep tasks in Git
 */
export function formatInitDryRun(plan: InitDryRun): string {
	const lines = [
		'Dry run; nothing was changed. Init would:',
		'  create .taskgraph/ with tasks, settings and PRD templates'
	];
	if (plan.importFrom) {
		lines.push(
			`  import tasks, docs, reports and settings from ${plan.importFrom}/`
		);
	}
	lines.push('  create or update .gitignore and .env.example');
	if (plan.startGit) lines.push('  start a Git repository');
	if (plan.mergeDriver) {
		lines.push('  set up Git to merge tasks.json by task (.gitattributes)');
	}
	lines.push(
		plan.storeTasksInGit ? '  keep tasks in Git' : '  keep tasks out of Git'
	);
	if (plan.aliasFile) {
		lines.push(`  add the tm alias to ${terminalSafe(plan.aliasFile)}`);
	}
	if (plan.claudeCode) {
		lines.push(
			plan.mcp
				? '  import TaskGraph’s guide in CLAUDE.md and add the MCP server to .mcp.json'
				: '  import TaskGraph’s guide in CLAUDE.md'
		);
	}
	return lines.join('\n');
}
