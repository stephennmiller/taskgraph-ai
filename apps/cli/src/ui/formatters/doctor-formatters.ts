/**
 * @fileoverview What `taskgraph doctor` found: one line per check, and the fix
 * under each one that failed, e.g.
 *
 *   ✓ Node            22.13.0
 *   ✓ Claude Code     2.1.309
 *   ✓ Claude sign-in  signed in
 *   ✓ Project         .
 *   ✗ Plugin          not installed
 *     In Claude Code, run /plugin marketplace add stephennmiller/taskgraph-ai
 *     then /plugin install taskgraph@taskgraph
 *   – MCP server      optional; add it with taskgraph init --mcp
 *
 * Checks skipped because an earlier one failed (sign-in and plugin without
 * Claude Code, MCP outside a project) get no line: the failure above already
 * says what to fix first.
 */

import path from 'node:path';
import {
	type DoctorCheck,
	type DoctorCheckName,
	type DoctorReport,
	sanitizeForTerminal
} from '@tm/core';
import chalk from 'chalk';
import { theme, withCode } from '../theme.js';
import { PLUGIN_MARKETPLACE, PLUGIN_NAME } from './init-summary-formatters.js';

const LABELS: Record<DoctorCheckName, string> = {
	node: 'Node',
	claude: 'Claude Code',
	'signed-in': 'Claude sign-in',
	project: 'Project',
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
	/** Lines under a failed check that say how to fix it */
	fix?: string[];
}

const clean = (text: string | undefined) => sanitizeForTerminal(text ?? '');

/** `.` for the folder doctor ran in, else the shorter of relative or absolute */
function shownPath(dir: string, cwd: string): string {
	const relative = path.relative(cwd, dir) || '.';
	return relative.length < dir.length ? relative : dir;
}

function row(
	check: DoctorCheck,
	cliVersion: string,
	options: DoctorFormatOptions
): Row | null {
	const pass = chalk.green('✓');
	const fail = chalk.red('✗');
	const detail = clean(check.detail);

	if (check.status === 'pass') {
		const value =
			check.name === 'signed-in'
				? 'signed in'
				: check.name === 'project'
					? shownPath(detail, options.cwd)
					: detail || 'installed';
		return { mark: pass, value };
	}

	if (check.status === 'skip') {
		return check.problem === 'not-set-up'
			? {
					mark: theme.muted('–'),
					value: theme.muted(
						withCode('optional; add it with `taskgraph init --mcp`')
					)
				}
			: null;
	}

	switch (check.name) {
		case 'node':
			return {
				mark: fail,
				value: `${detail}, needs ${check.required}`,
				fix: [`Install Node ${check.required?.replace(/^>=\s*/, '')} or later`]
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
				fix: ['Run `claude auth login`']
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
					value: `${detail ? `${detail} ` : ''}needs taskgraph ${check.required}; this is ${clean(cliVersion)}`,
					fix: ['Run `npm install -g taskgraph-ai@latest`']
				};
			}
			return {
				mark: fail,
				value: 'not installed',
				fix: [
					`In Claude Code, run \`/plugin marketplace add ${PLUGIN_MARKETPLACE}\``,
					`then \`/plugin install ${PLUGIN_NAME}\``
				]
			};
		default:
			return { mark: fail, value: detail };
	}
}

/**
 * Format `taskgraph doctor`'s report: a ✓, ✗ or – line per check, with the
 * fix muted under each ✗.
 */
export function formatDoctorReport(
	report: DoctorReport,
	options: DoctorFormatOptions
): string {
	const rows = report.checks
		.map((check) => ({
			label: LABELS[check.name],
			row: row(check, report.cliVersion, options)
		}))
		.filter(
			(entry): entry is { label: string; row: Row } => entry.row !== null
		);
	const width = Math.max(...rows.map((entry) => entry.label.length));

	const lines: string[] = [];
	for (const { label, row: shown } of rows) {
		lines.push(`${shown.mark} ${label.padEnd(width)}  ${shown.value}`);
		for (const fix of shown.fix ?? []) {
			lines.push(`  ${theme.muted(withCode(fix))}`);
		}
	}
	return lines.join('\n');
}
