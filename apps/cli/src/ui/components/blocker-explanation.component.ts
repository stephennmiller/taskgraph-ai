/**
 * @fileoverview Draws a @tm/core BlockerExplanation: the chain of unfinished
 * dependencies behind a task, then what to do about each root cause
 *
 * Example (a subtask waits on what its parent waits on):
 *   ○ 2.1  Write the auth schema
 *   Blocked by:
 *   └─ ○ 2  Build the login API  ← parent
 *      └─ ○ 1  Set up the database  ← ready to start
 *
 *   To unblock:
 *     Do 1 (Set up the database): nothing else stands in its way.
 */

import {
	type BlockerExplanation,
	type BlockerKind,
	type BlockerNode,
	type BlockerRootCause,
	sanitizeForTerminal,
	type TaskStatus
} from '@tm/core';
import chalk from 'chalk';
import { getStatusIcon } from '../formatters/status-formatters.js';
import { drawTree, truncate, wrapLine } from '../layout/helpers.js';
import { theme } from '../theme.js';

export interface RenderBlockerExplanationOptions {
	/** Total line width to fit titles into */
	width?: number;
}

/** Plain-text width, ignoring ANSI color codes */
const visible = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '').length;

// Commands join their words with KEEP so wrapping moves a command whole instead of splitting it
const KEEP = '\u0000';
const cmd = (text: string) => theme.brand(text.replaceAll(' ', KEEP));

const joinAnd = (items: string[]) =>
	items.length < 2
		? items.join('')
		: `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

const label = (id: string, title?: string) => (title ? `${id} (${title})` : id);

function describeStart(e: BlockerExplanation): string[] {
	if (e.status === 'done') return ['Already done.'];
	if (e.status === 'cancelled') return ['Cancelled.'];
	if (e.status === 'pending') {
		return [
			`Not blocked. Start it with: ${cmd(`taskgraph set-status ${e.id} in-progress`)}`
		];
	}
	return [`Not blocked by any dependencies (status: ${e.status}).`];
}

export function renderBlockerExplanation(
	explanation: BlockerExplanation,
	options: RenderBlockerExplanationOptions = {}
): string[] {
	explanation = sanitizeForTerminal(explanation);
	const width = options.width ?? 100;
	const lines: string[] = [];
	// A command wider than the line breaks at its spaces after all
	const wrap = (text: string, indent: string) => {
		const room = width - indent.length;
		const fits = text.split(' ').every((word) => visible(word) <= room);
		return wrapLine(
			fits ? text : text.replaceAll(KEEP, ' '),
			width,
			indent
		).map((l) => l.replaceAll(KEEP, ' '));
	};

	const note = (node: BlockerNode): string => {
		if (node.repeated) return 'shown above';
		if (node.parentOf) return 'parent';
		const notes: Record<BlockerKind, string> = {
			ready: 'ready to start',
			'in-progress': 'in progress',
			review: 'in review',
			stalled: `${node.status}, needs a decision`,
			missing: 'missing',
			cycle: 'loops back'
		};
		return node.kind ? notes[node.kind] : '';
	};

	const line = (node: BlockerNode, lead: string): string => {
		const icon =
			node.kind === 'missing'
				? chalk.yellow('⚠')
				: getStatusIcon(node.status as TaskStatus);
		const head = `${lead}${icon} ${theme.brand(node.id)}  `;
		const suffix = note(node) ? theme.muted(`  ← ${note(node)}`) : '';
		const title = node.kind === 'missing' ? 'no such task' : (node.title ?? '');
		const room = Math.max(12, width - visible(head) - visible(suffix));
		return head + truncate(title, room) + suffix;
	};

	lines.push(
		`${getStatusIcon(explanation.status)} ${theme.brand(explanation.id)}  ${truncate(explanation.title, Math.max(12, width - explanation.id.length - 4))}`
	);

	if (!explanation.blocked) {
		lines.push(...describeStart(explanation).flatMap((l) => wrap(l, '  ')));
		return lines;
	}

	lines.push('Blocked by:');
	for (const l of drawTree(explanation.blockers, (n) => n.blockers, line)) {
		lines.push(l);
	}

	const fixes = unblockSteps(explanation.rootCauses);
	if (fixes.length)
		lines.push(
			'',
			'To unblock:',
			...fixes.flatMap((f) => wrap(`  ${f}`, '    '))
		);
	return lines;
}

function unblockSteps(causes: BlockerRootCause[]): string[] {
	const steps: string[] = [];

	const ready = causes.filter((c) => c.kind === 'ready');
	if (ready.length) {
		steps.push(
			`Do ${joinAnd(ready.map((c) => label(c.id, c.title)))}: nothing else stands in ${ready.length > 1 ? 'their' : 'its'} way.`
		);
	}

	for (const c of causes) {
		if (c.kind === 'in-progress') {
			steps.push(`Finish ${label(c.id, c.title)}: it's in progress.`);
		} else if (c.kind === 'review') {
			steps.push(
				`${c.id} is in review. Close it with: ${cmd(`taskgraph set-status ${c.id} done`)}`
			);
		} else if (c.kind === 'stalled') {
			steps.push(
				`${c.id} is ${c.status}. Reopen it with: ${cmd(`taskgraph set-status ${c.id} pending`)}`
			);
		} else if (c.kind === 'missing') {
			const fixes = (c.listedBy ?? []).map((by) =>
				cmd(`taskgraph remove-dependency --id=${by} --depends-on=${c.id}`)
			);
			steps.push(`${c.id} is not a task. Remove it with: ${joinAnd(fixes)}`);
		} else if (c.kind === 'cycle') {
			const fixes = (c.edges ?? []).map((e) =>
				cmd(`taskgraph remove-dependency --id=${e.from} --depends-on=${e.to}`)
			);
			const members = c.cycle ?? [c.id];
			steps.push(
				members.length === 1
					? `${c.id} depends on itself. Remove it with: ${joinAnd(fixes)}`
					: `${members.join(', ')} depend on each other. Break the loop with: ${joinAnd(fixes)}`
			);
		}
	}
	return steps;
}
