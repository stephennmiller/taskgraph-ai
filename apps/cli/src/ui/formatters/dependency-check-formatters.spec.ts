import { stripVTControlCharacters as plain } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
	formatDependencyCheck,
	formatDependencyFixes
} from './dependency-check-formatters.js';

import {
	HOSTILE,
	sgrFree,
	UNSAFE
} from '../../../tests/helpers/hostile-text.js';

const counts = { taskCount: 4, subtaskCount: 0, dependencyCount: 1 };
const lines = (text: string) => plain(text).split('\n');

describe('formatDependencyCheck', () => {
	it('says there are no problems in one line, with what was checked', () => {
		expect(lines(formatDependencyCheck({ ...counts, issues: [] }))).toEqual([
			'✓ No dependency problems · 4 tasks, 1 dependency'
		]);
	});

	it('counts subtasks and pluralizes dependencies', () => {
		const output = formatDependencyCheck({
			taskCount: 1,
			subtaskCount: 3,
			dependencyCount: 2,
			issues: []
		});
		expect(plain(output)).toBe(
			'✓ No dependency problems · 1 task, 3 subtasks, 2 dependencies'
		);
	});

	it('lists each problem once and points at fix-dependencies', () => {
		const output = formatDependencyCheck({
			...counts,
			issues: [
				{ type: 'missing', taskId: 4, dependencyId: 99 },
				{ type: 'self', taskId: 4 },
				{ type: 'missing', taskId: '1.1', dependencyId: '1.7' }
			]
		});

		expect(lines(output)).toEqual([
			'✗ 3 dependency problems',
			"  4    depends on task 99, which doesn't exist",
			'  4    depends on itself',
			"  1.1  depends on subtask 1.7, which doesn't exist",
			'Run taskgraph fix-dependencies to remove them'
		]);
	});

	it('reports a related link to a missing task, which fix-dependencies removes', () => {
		const output = formatDependencyCheck({
			...counts,
			issues: [{ type: 'missing-link', taskId: 4, dependencyId: '9.1' }]
		});

		expect(lines(output)).toEqual([
			'✗ 1 dependency problem',
			"  4  links to subtask 9.1, which doesn't exist",
			'Run taskgraph fix-dependencies to remove them'
		]);
		expect(
			lines(
				formatDependencyFixes({
					...counts,
					fixes: [{ type: 'missing-link', taskId: 4, dependencyId: 9 }]
				})
			)
		).toEqual([
			'✓ Fixed 1 dependency problem',
			"  4  removed its link to task 9, which doesn't exist"
		]);
	});

	it('suggests remove-dependency when only task loops are left', () => {
		const output = formatDependencyCheck({
			...counts,
			issues: [
				{ type: 'circular', taskId: 2 },
				{ type: 'circular', taskId: 3 }
			]
		});

		expect(lines(output).at(-1)).toBe(
			'Break the loop with taskgraph remove-dependency --id=<id> --depends-on=<id>'
		);
	});

	it('suggests fix-dependencies for a loop it can break', () => {
		const output = formatDependencyCheck({
			...counts,
			issues: [{ type: 'circular', taskId: '1.2', fixable: true }]
		});
		expect(lines(output).at(-1)).toBe(
			'Run taskgraph fix-dependencies to remove them'
		);
	});

	it('suggests remove-dependency for a subtask loop that runs through a task', () => {
		const output = formatDependencyCheck({
			...counts,
			issues: [
				{ type: 'circular', taskId: 1, fixable: false },
				{ type: 'circular', taskId: '1.1', fixable: false }
			]
		});
		expect(lines(output).at(-1)).toBe(
			'Break the loop with taskgraph remove-dependency --id=<id> --depends-on=<id>'
		);
	});

	it('fits every line in 80 columns', () => {
		const output = formatDependencyCheck(
			{
				...counts,
				issues: [
					{ type: 'missing', taskId: '120.14', dependencyId: '9999.9999' }
				]
			},
			80
		);
		for (const line of lines(output)) {
			expect(line.length).toBeLessThanOrEqual(80);
		}
	});

	it('cuts rows to a narrow terminal', () => {
		const output = formatDependencyCheck(
			{
				...counts,
				issues: [{ type: 'missing', taskId: 4, dependencyId: 99 }]
			},
			30
		);
		const row = lines(output)[1];
		expect(row.length).toBeLessThanOrEqual(30);
		expect(row.endsWith('…')).toBe(true);
	});
});

describe('formatDependencyFixes', () => {
	it('says there was nothing to fix in one line', () => {
		expect(
			lines(formatDependencyFixes({ ...counts, fixes: [], remaining: [] }))
		).toEqual(['✓ No dependency problems · 4 tasks, 1 dependency']);
	});

	it('lists what was removed, grouped by task', () => {
		const output = formatDependencyFixes({
			...counts,
			fixes: [
				{ type: 'duplicate', taskId: 2, dependencyId: 1 },
				{ type: 'self', taskId: '1.1' },
				{ type: 'missing', taskId: 4, dependencyId: 99 },
				{ type: 'circular', taskId: '1.2', dependencyId: '1.3' },
				{ type: 'self', taskId: 4 }
			]
		});

		expect(lines(output)).toEqual([
			'✓ Fixed 5 dependency problems',
			'  1.1  removed its dependency on itself',
			'  1.2  removed subtask 1.3 to break a loop',
			'  2    removed a duplicate of task 1',
			"  4    removed task 99, which doesn't exist",
			'  4    removed its dependency on itself'
		]);
	});

	it('says which dependency it rewrote in its stored form (#864)', () => {
		const output = formatDependencyFixes({
			...counts,
			fixes: [
				{ type: 'rewritten', taskId: 3, dependencyId: '1.1', storedAs: '1.01' }
			]
		});

		expect(lines(output)).toEqual([
			'✓ Fixed 1 dependency problem',
			'  3  wrote 1.01 as subtask 1.1'
		]);
	});

	it('reports problems it left for the user', () => {
		const output = formatDependencyFixes({
			...counts,
			fixes: [{ type: 'self', taskId: 4 }],
			remaining: [
				{ type: 'circular', taskId: 2 },
				{ type: 'circular', taskId: 3 }
			]
		});

		expect(lines(output)).toEqual([
			'✓ Fixed 1 dependency problem',
			'  4  removed its dependency on itself',
			'✗ 2 problems left',
			'  2  is part of a dependency loop',
			'  3  is part of a dependency loop',
			'Break the loop with taskgraph remove-dependency --id=<id> --depends-on=<id>'
		]);
	});

	it("never suggests itself for what's left, even a loop through a subtask", () => {
		// A loop that runs through task 1 and its subtask 1.1 can't be broken
		// by fix-dependencies, so pointing back at it would go round in circles
		const output = formatDependencyFixes({
			...counts,
			fixes: [],
			remaining: [
				{ type: 'circular', taskId: 1 },
				{ type: 'circular', taskId: '1.1' }
			]
		});
		expect(lines(output).at(-1)).toBe(
			'Break the loop with taskgraph remove-dependency --id=<id> --depends-on=<id>'
		);
		expect(plain(output)).not.toContain('fix-dependencies');
	});

	it("doesn't claim success when it fixed nothing but problems remain", () => {
		const output = formatDependencyFixes({
			...counts,
			fixes: [],
			remaining: [{ type: 'circular', taskId: 2 }]
		});
		expect(lines(output)[0]).toBe('✗ 1 dependency problem');
	});
});

describe('dependency output with escape sequences in IDs', () => {
	it('prints the IDs without them', () => {
		const issue = {
			type: 'missing' as const,
			taskId: 3,
			dependencyId: HOSTILE
		};
		const outputs = [
			formatDependencyCheck({ ...counts, issues: [issue] }),
			formatDependencyFixes({
				...counts,
				fixes: [{ type: 'missing', taskId: 3, dependencyId: HOSTILE }]
			})
		].map(sgrFree);

		expect(outputs[0]).toContain('depends on task Fix login');
		for (const out of outputs) expect(out).not.toMatch(UNSAFE);
	});
});

describe('IDs read from tasks.json (#398)', () => {
	// An OSC sequence that would retitle the terminal window
	const hostile = '9\u001b]0;pwned\u0007';
	const escapes = /\u001b\]|\u0007/;

	it('fix-dependencies prints them without escape sequences', () => {
		const output = formatDependencyFixes({
			...counts,
			fixes: [
				{ type: 'missing', taskId: `4\u001b]0;x\u0007`, dependencyId: hostile },
				{ type: 'missing-link', taskId: 5, dependencyId: '7\nfake line' }
			],
			remaining: [{ type: 'circular', taskId: `2\u0007` }]
		});

		expect(output).not.toMatch(escapes);
		expect(lines(output)).toEqual([
			'✓ Fixed 2 dependency problems',
			"  4  removed task 9, which doesn't exist",
			"  5  removed its link to task 7 fake line, which doesn't exist",
			'✗ 1 problem left',
			'  2  is part of a dependency loop',
			'Break the loop with taskgraph remove-dependency --id=<id> --depends-on=<id>'
		]);
	});

	it('validate-dependencies prints them without escape sequences', () => {
		const output = formatDependencyCheck({
			...counts,
			issues: [{ type: 'missing', taskId: 4, dependencyId: hostile }]
		});

		expect(output).not.toMatch(escapes);
		expect(lines(output)[1]).toBe(
			"  4  depends on task 9, which doesn't exist"
		);
	});

	it('shows an ID that is only escape sequences as ?', () => {
		const output = formatDependencyFixes({
			...counts,
			fixes: [{ type: 'missing', taskId: '\u001b[2J', dependencyId: '\u0007' }]
		});

		expect(lines(output)[1]).toBe("  ?  removed task ?, which doesn't exist");
	});
});
