import type { DependencyTree, DependencyTreeNode } from '@tm/core';
import { describe, expect, it } from 'vitest';
import { renderDependencyTree } from './dependency-tree.component.js';

const node = (
	id: string,
	children: DependencyTreeNode[] = [],
	extra: Partial<DependencyTreeNode> = {}
): DependencyTreeNode => ({
	id,
	title: `Task ${id}`,
	status: 'pending',
	alsoNeeds: [],
	missing: [],
	children,
	...extra
});

const plain = (lines: string[]) =>
	lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, ''));

const tree = (roots: DependencyTreeNode[], cyclic: DependencyTreeNode[] = []) =>
	({ roots, cyclic, total: 0 }) as DependencyTree;

describe('renderDependencyTree', () => {
	it('draws children with tree connectors', () => {
		const lines = plain(
			renderDependencyTree(
				tree([
					node('1', [node('2', [node('4')]), node('3')], { status: 'done' })
				])
			)
		);

		expect(lines.slice(0, 4)).toEqual([
			'✓ 1  Task 1',
			'├─ ○ 2  Task 2',
			'│  └─ ○ 4  Task 4',
			'└─ ○ 3  Task 3'
		]);
	});

	it('marks the next task, and its parent when next is a subtask', () => {
		const [line] = plain(
			renderDependencyTree(tree([node('3')]), { nextId: '3.2' })
		);

		expect(line).toBe('○ 3  Task 3  ← next: 3.2');
	});

	it('lists extra and missing dependencies after the title', () => {
		const [line] = plain(
			renderDependencyTree(
				tree([node('4', [], { alsoNeeds: ['2'], missing: ['99'] })])
			)
		);

		expect(line).toBe('○ 4  Task 4 · needs 2 · missing 99');
	});

	it('truncates long titles to fit the width', () => {
		const [line] = plain(
			renderDependencyTree(tree([node('1', [], { title: 'x'.repeat(200) })]), {
				width: 40
			})
		);

		expect(line.length).toBe(40);
		expect(line.endsWith('...')).toBe(true);
	});

	it('calls out tasks stuck in a dependency loop', () => {
		const lines = plain(
			renderDependencyTree(
				tree(
					[],
					[
						node('2', [], { alsoNeeds: ['3'] }),
						node('3', [], { alsoNeeds: ['2'] })
					]
				)
			)
		);

		expect(lines).toContain('⚠ These tasks depend on each other in a loop:');
		expect(lines).toContain(
			'  Break it with taskgraph remove-dependency --id=2 --depends-on=3'
		);
	});

	it('shows a legend for only the statuses on screen', () => {
		const lines = plain(
			renderDependencyTree(tree([node('1', [node('2')], { status: 'done' })]))
		);

		expect(lines.at(-1)).toBe('✓ done  ○ pending');
	});
});
