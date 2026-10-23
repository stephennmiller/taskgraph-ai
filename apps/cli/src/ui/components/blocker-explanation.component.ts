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

import type {
	BlockerExplanation,
	BlockerKind,
	BlockerNode,
	BlockerRootCause,
	TaskStatus
} from '@tm/core';
import chalk from 'chalk';
import { getStatusIcon } from '../formatters/status-formatters.js';
import { truncate } from '../layout/helpers.js';
import { theme } from '../theme.js';

export interface RenderBlockerExplanationOptions {
	/** Total line width to fit titles into */
	width?: number;
}

/** Plain-text width, ignoring ANSI color codes */
const visible = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '').length;

const cmd = (text: string) => theme.brand(text);

const joinAnd = (items: string[]) =>
	items.length < 2
		? items.join('')
		: `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

const label = (id: string, title?: string) => (title ? `${id} (${title})` : id);

function describeStart(e: BlockerExplanation): string[] {
	if (e.status === 'done' || e.status === 'completed') return ['Already done.'];
	if (e.status === 'cancelled') return ['Cancelled.'];
	if (e.status === 'pending') {
		return [
			`Not blocked. Start it with: ${cmd(`taskgraph set-status --id=${e.id} --status=in-progress`)}`
		];
	}
	return [`Not blocked by any dependencies (status: ${e.status}).`];
}

export function renderBlockerExplanation(
	explanation: BlockerExplanation,
	options: RenderBlockerExplanationOptions = {}
): string[] {
	const width = options.width ?? 100;
	const lines: string[] = [];

	const note = (node: BlockerNode): string => {
		if (node.repeated) return 'shown above';
		if (node.parentOf) return 'parent';
		const notes: Record<BlockerKind, string> = {
			ready: 'ready to start',
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

	const walk = (node: BlockerNode, prefix: string, last: boolean) => {
		lines.push(line(node, prefix + theme.muted(last ? '└─ ' : '├─ ')));
		const childPrefix = prefix + theme.muted(last ? '   ' : '│  ');
		node.blockers.forEach((b, i) =>
			walk(b, childPrefix, i === node.blockers.length - 1)
		);
	};

	lines.push(
		`${getStatusIcon(explanation.status)} ${theme.brand(explanation.id)}  ${truncate(explanation.title, Math.max(12, width - explanation.id.length - 4))}`
	);

	if (!explanation.blocked) {
		lines.push(...describeStart(explanation));
		return lines;
	}

	lines.push('Blocked by:');
	explanation.blockers.forEach((b, i) =>
		walk(b, '', i === explanation.blockers.length - 1)
	);

	const fixes = unblockSteps(explanation.rootCauses);
	if (fixes.length)
		lines.push('', 'To unblock:', ...fixes.map((f) => `  ${f}`));
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
		if (c.kind === 'stalled') {
			steps.push(
				`${c.id} is ${c.status}. Reopen it with: ${cmd(`taskgraph set-status --id=${c.id} --status=pending`)}`
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
