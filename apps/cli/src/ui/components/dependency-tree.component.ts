/**
 * @fileoverview Draws a @tm/core DependencyTree as an indented terminal tree
 *
 * Example:
 *   ✓ 1  Set up the database
 *   └─ ○ 2*  Build the login API · wave 1 · blocks 2 ◆
 *      └─ ○ 3  Add the dashboard · wave 2 · needs 4* · blocks 1 ◆
 *
 *   Bottlenecks
 *     2  blocks 2  Build the login API
 *     3  blocks 1  Add the dashboard
 *
 *   Critical path: 2 → 3
 *   2 waves · 1 task can run now: 2
 *
 *   ✓ done  ○ pending
 *   ◆ critical path  * dependency inferred by AI
 *
 * Which tasks are bottlenecks, on the critical path, in which parallel wave
 * or inferred comes from tm-core; this only looks them up and draws them.
 */

import {
	type DependencyTree,
	type DependencyTreeNode,
	sanitizeForTerminal,
	type TaskStatus
} from '@tm/core';
import chalk from 'chalk';
import { getStatusIcon } from '../formatters/status-formatters.js';
import { formatWaveSummary } from '../formatters/wave-formatters.js';
import { drawTree, truncate } from '../layout/helpers.js';
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

/** "Critical path: 1 → 2 → ..." wrapped between IDs, continuation lines indented */
function wrapPath(ids: string[], width: number): string[] {
	const label = 'Critical path:';
	const rows: string[] = [];
	let row = `${label} ${ids[0]}`;
	for (const id of ids.slice(1)) {
		const piece = ` → ${id}`;
		// Leave room for the " →" that ends a row
		if (row.length + piece.length > width - 2) {
			rows.push(`${row} →`);
			row = `  ${id}`;
		} else {
			row += piece;
		}
	}
	rows.push(row);
	return rows.map((r, i) =>
		i === 0 ? theme.muted(label) + r.slice(label.length) : r
	);
}

export function renderDependencyTree(
	tree: DependencyTree,
	options: RenderDependencyTreeOptions = {}
): string[] {
	tree = sanitizeForTerminal(tree);
	const width = options.width ?? 100;
	const next = options.nextId ? String(options.nextId) : null;
	const nextTask = next?.split('.')[0];
	const lines: string[] = [];
	const seen = new Set<TaskStatus>();
	const blocksById = new Map(tree.bottlenecks.map((b) => [b.id, b.blocks]));
	const critical = new Set(tree.criticalPath);
	let showedCritical = false;
	let showedInferred = false;

	const line = (node: DependencyTreeNode, lead: string, parentId?: string) => {
		seen.add(node.status);
		const isNext = node.id === nextTask;
		const isInferred = (dep: string) => node.inferred.includes(dep);
		const withMark = (dep: string) => {
			if (!isInferred(dep)) return dep;
			showedInferred = true;
			return `${dep}*`;
		};
		const notes: string[] = [];
		if (node.wave !== null) {
			notes.push(`wave ${node.wave}`);
		}
		if (node.alsoNeeds.length) {
			notes.push(`needs ${node.alsoNeeds.map(withMark).join(', ')}`);
		}
		const blocks = blocksById.get(node.id);
		if (blocks !== undefined) notes.push(`blocks ${blocks}`);
		const onPath = critical.has(node.id);
		if (onPath) showedCritical = true;
		const inferredParent = parentId !== undefined && isInferred(parentId);
		if (inferredParent) showedInferred = true;
		const idLabel = inferredParent
			? `${theme.brand(node.id)}${theme.muted('*')}`
			: theme.brand(node.id);
		const missing = node.missing.length
			? chalk.yellow(` · missing ${node.missing.join(', ')}`)
			: '';
		const suffix =
			(notes.length ? theme.muted(` · ${notes.join(' · ')}`) : '') +
			missing +
			(onPath ? theme.brand(' ◆') : '') +
			(isNext
				? theme.brand.bold(next !== nextTask ? `  ← next: ${next}` : '  ← next')
				: '');
		const head = `${lead}${getStatusIcon(node.status)} ${idLabel}  `;
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

	tree.roots.forEach((root, i) => {
		const prev = tree.roots[i - 1];
		if (prev && (prev.children.length || root.children.length)) lines.push('');
		lines.push(line(root, ''));
		const below = drawTree(
			root.children,
			(n) => n.children,
			(node, lead, parent) => line(node, lead, (parent ?? root).id)
		);
		for (const l of below) lines.push(l);
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

	if (tree.bottlenecks.length) {
		const idWidth = Math.max(...tree.bottlenecks.map((b) => b.id.length));
		const blocks = tree.bottlenecks.map((b) => `blocks ${b.blocks}`);
		const blocksWidth = Math.max(...blocks.map((t) => t.length));
		const room = Math.max(12, width - (2 + idWidth + 2 + blocksWidth + 2));
		lines.push('', theme.muted('Bottlenecks'));
		tree.bottlenecks.forEach((b, i) => {
			lines.push(
				`  ${theme.brand(b.id.padEnd(idWidth))}  ${chalk.yellow(blocks[i].padEnd(blocksWidth))}  ${truncate(b.title, room)}`
			);
		});
	}
	const waveSummary = formatWaveSummary(tree.waves, width);
	if (tree.criticalPath.length || waveSummary) lines.push('');
	if (tree.criticalPath.length)
		lines.push(...wrapPath(tree.criticalPath, width));
	if (waveSummary) lines.push(waveSummary);

	const legend = LEGEND.filter(([s]) => seen.has(s))
		.map(([s, label]) => `${getStatusIcon(s)} ${theme.muted(label)}`)
		.join('  ');
	if (legend) lines.push('', legend);
	const markers = [
		showedCritical ? '◆ critical path' : '',
		showedInferred ? '* dependency inferred by AI' : ''
	].filter(Boolean);
	if (markers.length) lines.push(theme.muted(markers.join('  ')));
	return lines;
}
