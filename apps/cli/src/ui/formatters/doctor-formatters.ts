/**
 * @fileoverview What `taskgraph doctor` found: one line per check, and the fix
 * under each one that failed, e.g.
 *
 *   ✓ Node            22.13.0
 *   ✓ Claude Code     2.1.309
 *   ✓ Claude sign-in  signed in
 *   ✓ Project         .
 *   – Plugin          optional; not installed
 *     In Claude Code, run /plugin marketplace add stephennmiller/taskgraph-ai
 *     then /plugin install taskgraph@taskgraph
 *     and /plugin install taskgraph-hooks@taskgraph for its hooks
 *   – MCP server      optional; add it with taskgraph init --mcp
 *
 * With only the Claude Code bundled with TaskGraph (no `claude` on PATH), the
 * row reads `2.1.309, bundled with taskgraph`, and signing in starts with
 * installing Claude Code, since there's no `claude` to run `auth login` with.
 *
 * A data file that doesn't parse, or a task that breaks a rule, is listed
 * under its row with the fix when `doctor --fix` can't make it:
 *
 *   ✗ Data files      1 can't be read
 *     .taskgraph/config.json has a git conflict marker on line 3
 *       Resolve the conflict in the file, then run taskgraph doctor again
 *   ✗ Tasks           2 problems in .taskgraph/tasks/tasks.json
 *     Task 3 has status "finished"
 *       Run taskgraph set-status --id=3 --status=pending --tag=master, then set
 *       the status it should have
 *     Task 6 depends on non-existent task 99
 *     Run taskgraph doctor --fix to repair 1 of them
 *
 * `doctor --fix` leads with what it changed:
 *
 *   ✓ Repaired 1 problem in .taskgraph/tasks/tasks.json
 *     Task 6 no longer depends on 99, which doesn't exist
 *
 * Checks skipped because an earlier one failed (sign-in and plugin without
 * Claude Code, MCP outside a project) get no line: the failure above already
 * says what to fix first.
 */

import path from 'node:path';
import {
	type DoctorCheck,
	type DoctorCheckName,
	type DoctorFinding,
	type DoctorReport,
	minimumVersion,
	sanitizeForTerminal
} from '@tm/core';
import chalk from 'chalk';
import { terminalWidth, wrapLine } from '../layout/helpers.js';
import { theme, withCode } from '../theme.js';
import {
	HOOKS_PLUGIN_NAME,
	PLUGIN_MARKETPLACE,
	PLUGIN_NAME
} from './init-summary-formatters.js';

const LABELS: Record<DoctorCheckName, string> = {
	node: 'Node',
	claude: 'Claude Code',
	'signed-in': 'Claude sign-in',
	project: 'Project',
	'data-files': 'Data files',
	tasks: 'Tasks',
	plugin: 'Plugin',
	mcp: 'MCP server'
};

export interface DoctorFormatOptions {
	/** Folder doctor ran in, to show the project path relative to it */
	cwd: string;
}

interface Row {
	mark: string;
	value: string;
	/** Lines under a failed or optional check that say how to fix or add it */
	fix?: string[];
	/** Lines under a failed check, already styled: each finding and its fix */
	lines?: string[];
}

/** Findings listed under a row; `--json` has them all */
const MAX_FINDINGS = 20;

const plural = (count: number, noun: string) =>
	`${count} ${noun}${count === 1 ? '' : 's'}`;

/** ` · tag feature` for a tag other than master */
const tagNote = (tag: string | undefined) =>
	tag === undefined || tag === 'master'
		? ''
		: theme.muted(` · tag ${clean(tag)}`);

/** `text` wrapped to the terminal (80 columns at most) under `indent` */
function wrapped(text: string, indent: string): string[] {
	return wrapLine(
		`${indent}${clean(text)}`,
		Math.min(terminalWidth(), 80),
		indent
	);
}

/** Each finding, and under it the fix when `doctor --fix` can't make it */
function findingLines(findings: DoctorFinding[]): string[] {
	const lines = findings
		.slice(0, MAX_FINDINGS)
		.flatMap((finding) => [
			...wrapped(finding.message, '  ').map(
				(line, i, all) =>
					line + (i === all.length - 1 ? tagNote(finding.tag) : '')
			),
			...(finding.fix
				? wrapped(finding.fix, '    ').map((line) =>
						theme.muted(withCode(line))
					)
				: [])
		]);
	const more = findings.length - MAX_FINDINGS;
	if (more > 0) {
		lines.push(
			theme.muted(
				withCode(
					`  and ${more} more; \`taskgraph doctor --json\` lists them all`
				)
			)
		);
	}
	return lines;
}

const clean = (text: string | undefined) => sanitizeForTerminal(text ?? '');

/** `.` for the folder doctor ran in, else the shorter of relative or absolute */
function shownPath(dir: string, cwd: string): string {
	const relative = path.relative(cwd, dir) || '.';
	return relative.length < dir.length ? relative : dir;
}

function row(
	check: DoctorCheck,
	report: DoctorReport,
	options: DoctorFormatOptions
): Row | null {
	const pass = chalk.green('✓');
	const fail = chalk.red('✗');
	const detail = clean(check.detail);

	if (check.status === 'pass') {
		const value =
			check.name === 'signed-in'
				? 'signed in'
				: check.name === 'data-files'
					? `${plural(Number(detail), 'file')} read`
					: check.name === 'project'
						? shownPath(detail, options.cwd)
						: check.bundled
							? `${detail || 'installed'}, bundled with taskgraph`
							: detail || 'installed';
		return { mark: pass, value };
	}

	if (check.status === 'skip') {
		const optional = (value: string, fix?: string[]): Row => ({
			mark: theme.muted('–'),
			value: theme.muted(withCode(value)),
			fix
		});
		if (check.problem === 'not-set-up') {
			return optional('optional; add it with `taskgraph init --mcp`');
		}
		if (check.problem === 'not-installed') {
			return optional('optional; not installed', [
				`In Claude Code, run \`/plugin marketplace add ${PLUGIN_MARKETPLACE}\``,
				`then \`/plugin install ${PLUGIN_NAME}\``,
				`and \`/plugin install ${HOOKS_PLUGIN_NAME}\` for its hooks`
			]);
		}
		return null;
	}

	switch (check.name) {
		case 'node':
			return {
				mark: fail,
				value: `${detail}, needs ${check.required}`,
				fix: [
					`Install Node ${minimumVersion(check.required ?? '') ?? check.required} or later`
				]
			};
		case 'claude':
			return {
				mark: fail,
				value: 'not found',
				fix: ['Install it: `npm install -g @anthropic-ai/claude-code`']
			};
		case 'signed-in':
			return {
				mark: fail,
				value: 'signed out',
				// The bundled binary isn't on PATH, so `claude` can't be run as typed
				fix: report.checks.some((c) => c.name === 'claude' && c.bundled)
					? [
							'Install Claude Code: `npm install -g @anthropic-ai/claude-code`',
							'then run `claude auth login`'
						]
					: ['Run `claude auth login`']
			};
		case 'project':
			return {
				mark: fail,
				value:
					detail === options.cwd
						? 'none in this folder'
						: `none in ${shownPath(detail, options.cwd)}`,
				fix: ['Run `taskgraph init` to set one up, or cd into your project']
			};
		case 'data-files':
			return {
				mark: fail,
				value: `${check.findings?.length ?? 0} can't be read`,
				lines: findingLines(check.findings ?? [])
			};
		case 'tasks': {
			const findings = check.findings ?? [];
			const fixable = findings.filter((finding) => finding.fixable).length;
			const lines = findingLines(findings);
			if (check.repairError !== undefined) {
				lines.push(
					...wrapped(`Nothing was repaired: ${check.repairError}`, '  ')
				);
			} else if (fixable > 0) {
				lines.push(
					theme.muted(
						withCode(
							`  Run \`taskgraph doctor --fix\` to repair ${fixable === findings.length ? (fixable === 1 ? 'it' : 'them') : `${fixable} of them`}`
						)
					)
				);
			}
			return {
				mark: fail,
				value: `${plural(findings.length, 'problem')} in ${clean(findings[0]?.file)}`,
				lines
			};
		}
		case 'plugin':
			if (check.problem === 'disabled') {
				return {
					mark: fail,
					value: 'disabled',
					fix: [`Run \`claude plugin enable ${PLUGIN_NAME}\``]
				};
			}
			if (check.problem === 'too-old') {
				return {
					mark: fail,
					value: `${detail ? `${detail} ` : ''}needs taskgraph ${check.required}; this is ${clean(report.cliVersion)}`,
					fix: ['Run `npm install -g taskgraph-ai@latest`']
				};
			}
			return { mark: fail, value: detail };
		default:
			return { mark: fail, value: detail };
	}
}

/**
 * Format `taskgraph doctor`'s report: what `--fix` repaired, then a ✓, ✗ or
 * – line per check, with the fix muted under each ✗ and how to add the
 * plugin under its –.
 */
export function formatDoctorReport(
	report: DoctorReport,
	options: DoctorFormatOptions
): string {
	const rows = report.checks
		.map((check) => ({
			label: LABELS[check.name],
			row: row(check, report, options)
		}))
		.filter(
			(entry): entry is { label: string; row: Row } => entry.row !== null
		);
	const width = Math.max(...rows.map((entry) => entry.label.length));

	const lines: string[] = [];
	const repaired = report.checks.flatMap((check) => check.repaired ?? []);
	if (repaired.length > 0) {
		lines.push(
			`${chalk.green('✓')} Repaired ${plural(repaired.length, 'problem')} in .taskgraph/tasks/tasks.json`
		);
		for (const repair of repaired) {
			lines.push(
				...wrapped(repair.message, '  ').map(
					(line) => line + tagNote(repair.tag)
				)
			);
		}
	}
	for (const { label, row: shown } of rows) {
		lines.push(`${shown.mark} ${label.padEnd(width)}  ${shown.value}`);
		for (const fix of shown.fix ?? []) {
			lines.push(`  ${theme.muted(withCode(fix))}`);
		}
		lines.push(...(shown.lines ?? []));
	}
	return lines.join('\n');
}
