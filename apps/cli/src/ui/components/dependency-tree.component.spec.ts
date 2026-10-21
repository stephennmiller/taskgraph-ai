import type { Bottleneck, DependencyTree, DependencyTreeNode } from '@tm/core';
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
	inferred: [],
	children,
	...extra
});

const plain = (lines: string[]) =>
	lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, ''));

const tree = (
	roots: DependencyTreeNode[],
	cyclic: DependencyTreeNode[] = [],
	analysis: Partial<DependencyTree> = {}
): DependencyTree => ({
	roots,
	cyclic,
	total: 0,
	bottlenecks: [],
	criticalPath: [],
	...analysis
});

const bottleneck = (id: string, blocks: number): Bottleneck => ({
	id,
	title: `Task ${id}`,
	status: 'pending',
	blocks
});

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
	describe('analysis', () => {
		const withAnalysis = () =>
			plain(
				renderDependencyTree(
					tree([node('1', [node('2', [node('3')])])], [], {
						bottlenecks: [bottleneck('1', 2), bottleneck('2', 1)],
						criticalPath: ['1', '2', '3']
					})
				)
			);

		it('marks bottlenecks and critical path tasks on their lines', () => {
			const lines = withAnalysis();

			expect(lines[0]).toBe('○ 1  Task 1 · blocks 2 ◆');
			expect(lines[1]).toBe('└─ ○ 2  Task 2 · blocks 1 ◆');
			expect(lines[2]).toBe('   └─ ○ 3  Task 3 ◆');
		});

		it('lists the bottlenecks and the critical path after the tree', () => {
			const lines = withAnalysis();

			expect(lines).toContain('Bottlenecks');
			expect(lines).toContain('  1  blocks 2  Task 1');
			expect(lines).toContain('  2  blocks 1  Task 2');
			expect(lines).toContain('Critical path: 1 → 2 → 3');
		});

		it('names subtasks in the lists even though they are not tree nodes', () => {
			const lines = plain(
				renderDependencyTree(
					tree([node('2')], [], {
						bottlenecks: [bottleneck('2.1', 1)],
						criticalPath: ['2.1', '2.2']
					})
				)
			);

			expect(lines).toContain('  2.1  blocks 1  Task 2.1');
			expect(lines).toContain('Critical path: 2.1 → 2.2');
		});

		it('wraps a long critical path between IDs at 80 columns', () => {
			const ids = Array.from({ length: 30 }, (_, i) => String(i + 1));
			const lines = plain(
				renderDependencyTree(tree([node('1')], [], { criticalPath: ids }), {
					width: 80
				})
			);
			const path = lines.filter(
				(l) => l.startsWith('Critical path:') || l.startsWith('  ')
			);

			expect(path.length).toBeGreaterThan(1);
			for (const l of path) expect(l.length).toBeLessThanOrEqual(80);
			expect(path.slice(0, -1).every((l) => l.endsWith(' →'))).toBe(true);
			expect(path.slice(1).every((l) => /^ {2}\d/.test(l))).toBe(true);
			const joined = path.join(' ').replace(/ →/g, '').split(/\s+/);
			expect(joined.slice(2)).toEqual(ids);
		});

		it('fits bottleneck rows in narrow terminals and aligns 2-digit IDs', () => {
			const lines = plain(
				renderDependencyTree(
					tree([node('1')], [], {
						bottlenecks: [
							{ ...bottleneck('2', 12), title: 'x'.repeat(200) },
							bottleneck('10', 3)
						]
					}),
					{ width: 60 }
				)
			);
			const rows = lines.filter(
				(l) => l.includes('blocks') && l.startsWith('  ')
			);

			expect(rows).toHaveLength(2);
			for (const r of rows) expect(r.length).toBeLessThanOrEqual(60);
			expect(rows[0].indexOf('blocks')).toBe(rows[1].indexOf('blocks'));
			expect(rows[0].indexOf('xxx')).toBe(rows[1].indexOf('Task'));
		});

		it('leaves the ◆ legend out when the path holds only subtasks', () => {
			const lines = plain(
				renderDependencyTree(
					tree([node('2')], [], { criticalPath: ['2.1', '2.2'] })
				)
			);

			expect(lines).toContain('Critical path: 2.1 → 2.2');
			expect(lines.join('\n')).not.toContain('◆');
		});

		it('says nothing when there is no analysis to show', () => {
			const lines = plain(renderDependencyTree(tree([node('1')])));

			expect(lines.join('\n')).not.toMatch(/Bottlenecks|Critical path|◆/);
		});

		it('explains the markers in the legend', () => {
			const legend = withAnalysis().at(-1);

			expect(legend).toContain('◆ critical path');
		});
	});

	describe('inferred dependencies', () => {
		it('marks an inferred parent edge on the task and explains it', () => {
			const lines = plain(
				renderDependencyTree(
					tree([node('1', [node('2', [], { inferred: ['1'] })])])
				)
			);

			expect(lines[1]).toBe('└─ ○ 2*  Task 2');
			expect(lines.at(-1)).toContain('* dependency inferred by AI');
		});

		it('marks inferred dependencies in the needs list', () => {
			const [line] = plain(
				renderDependencyTree(
					tree([node('4', [], { alsoNeeds: ['2', '3'], inferred: ['3'] })])
				)
			);

			expect(line).toBe('○ 4  Task 4 · needs 2, 3*');
		});

		it('explains * in the legend when only a needs-list entry is inferred', () => {
			const lines = plain(
				renderDependencyTree(
					tree([node('4', [], { alsoNeeds: ['3'], inferred: ['3'] })])
				)
			);

			expect(lines.at(-1)).toBe('* dependency inferred by AI');
		});

		it('marks the needs entry, not the task ID, when a farther dependency is inferred', () => {
			// 3 sits under 2 (its deepest dependency); the inferred one is 1
			const lines = plain(
				renderDependencyTree(
					tree([
						node('1', [
							node('2', [node('3', [], { alsoNeeds: ['1'], inferred: ['1'] })])
						])
					])
				)
			);

			expect(lines[2]).toBe('   └─ ○ 3  Task 3 · needs 1*');
		});

		it('leaves the legend alone when nothing is inferred', () => {
			const lines = plain(renderDependencyTree(tree([node('1')])));

			expect(lines.join('\n')).not.toContain('inferred');
		});
	});
});
