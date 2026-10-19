/**
 * @fileoverview Draws a @tm/core DependencyTree as an indented terminal tree
 */

import type { DependencyTree, DependencyTreeNode, TaskStatus } from '@tm/core';
import chalk from 'chalk';
import { getStatusIcon } from '../formatters/status-formatters.js';
import { truncate } from '../layout/helpers.js';
import { theme } from '../theme.js';

export interface RenderDependencyTreeOptions {
	/** ID from `next`; a subtask ID marks its parent task */
	nextId?: string | null;
	/** Total line width to fit titles into */
	width?: number;
}

const LEGEND: [TaskStatus, string][] = [
	['done', 'done'],
	['in-progress', 'in progress'],
	['review', 'review'],
	['pending', 'pending'],
	['blocked', 'blocked'],
	['deferred', 'deferred'],
	['cancelled', 'cancelled']
];

/** Plain-text width, ignoring ANSI color codes */
const visible = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '').length;

export function renderDependencyTree(
	tree: DependencyTree,
	options: RenderDependencyTreeOptions = {}
): string[] {
	const width = options.width ?? 100;
	const next = options.nextId ? String(options.nextId) : null;
	const nextTask = next?.split('.')[0];
	const lines: string[] = [];
	const seen = new Set<TaskStatus>();

	const line = (node: DependencyTreeNode, lead: string) => {
		seen.add(node.status);
		const isNext = node.id === nextTask;
		const notes: string[] = [];
		if (node.alsoNeeds.length) notes.push(`needs ${node.alsoNeeds.join(', ')}`);
		const missing = node.missing.length
			? chalk.yellow(` · missing ${node.missing.join(', ')}`)
			: '';
		const suffix =
			(notes.length ? theme.muted(` · ${notes.join(' · ')}`) : '') +
			missing +
			(isNext
				? theme.brand.bold(next !== nextTask ? `  ← next: ${next}` : '  ← next')
				: '');
		const head = `${lead}${getStatusIcon(node.status)} ${theme.brand(node.id)}  `;
		const room = Math.max(12, width - visible(head) - visible(suffix));
		const title = truncate(node.title, room);
		const styled =
			isNext || node.status === 'in-progress'
				? chalk.bold(title)
				: node.status === 'done' || node.status === 'cancelled'
					? theme.muted(title)
					: title;
		return head + styled + suffix;
	};

	const walk = (node: DependencyTreeNode, prefix: string, last: boolean) => {
		lines.push(line(node, prefix + theme.muted(last ? '└─ ' : '├─ ')));
		const childPrefix = prefix + theme.muted(last ? '   ' : '│  ');
		node.children.forEach((c, i) =>
			walk(c, childPrefix, i === node.children.length - 1)
		);
	};

	tree.roots.forEach((root, i) => {
		const prev = tree.roots[i - 1];
		if (prev && (prev.children.length || root.children.length)) lines.push('');
		lines.push(line(root, ''));
		root.children.forEach((c, j) =>
			walk(c, '', j === root.children.length - 1)
		);
	});

	if (tree.cyclic.length) {
		lines.push(
			'',
			chalk.yellow('⚠ These tasks depend on each other in a loop:')
		);
		for (const node of tree.cyclic) lines.push(line(node, '  '));
		const inLoop = new Set(tree.cyclic.map((n) => n.id));
		const first = tree.cyclic[0];
		const edge = first.alsoNeeds.find((d) => inLoop.has(d));
		if (edge) {
			lines.push(
				theme.muted('  Break it with ') +
					theme.brand(
						`taskgraph remove-dependency --id=${first.id} --depends-on=${edge}`
					)
			);
		}
	}

	const legend = LEGEND.filter(([s]) => seen.has(s))
		.map(([s, label]) => `${getStatusIcon(s)} ${theme.muted(label)}`)
		.join('  ');
	if (legend) lines.push('', legend);
	return lines;
}
