import { describe, expect, it } from 'vitest';
import {
	DEPENDENCY_SOURCES_KEY,
	assignMetadata,
	getDependencySource,
	hasDependency,
	pruneDependencySources,
	reconcileDependencySources,
	rekeyDependencySources,
	setDependencySource
} from './dependency-provenance.js';

const marks = (value: Record<string, string>) => ({
	[DEPENDENCY_SOURCES_KEY]: value
});

describe('subtask sibling ids', () => {
	it('keeps a task dependency, a string without a dot, under its plain key', () => {
		const subtask = {
			dependencies: ['3', '2.1'],
			metadata: marks({ '3': 'inferred' })
		};

		expect(getDependencySource(subtask, '3', 2)).toBe('inferred');
		expect(getDependencySource(subtask, '2.1', 2)).toBe('explicit');
	});

	it('does not read a task key as the sibling with that number', () => {
		const subtask = {
			dependencies: ['2.1'],
			metadata: marks({ '1': 'inferred' })
		};

		expect(getDependencySource(subtask, '2.1', 2)).toBe('explicit');
	});

	it('keeps a number of 100 or more as a task key', () => {
		const subtask = {
			dependencies: [150],
			metadata: marks({ '150': 'inferred' })
		};

		expect(getDependencySource(subtask, 150, 2)).toBe('inferred');
	});

	it('reads a dotted key for a numeric stored dependency under the parent', () => {
		const subtask = {
			dependencies: [1],
			metadata: marks({ '2.1': 'inferred' })
		};

		expect(getDependencySource(subtask, 1, 2)).toBe('inferred');
	});

	it('does not treat a numeric id as a sibling without a parent', () => {
		const task = { dependencies: [1], metadata: marks({ '2.1': 'inferred' }) };

		expect(getDependencySource(task, 1)).toBe('explicit');
	});

	it('writes a dotted key for a sibling and a plain key for a task', () => {
		const sibling = setDependencySource(undefined, 3, 'inferred', 2);
		const task = setDependencySource(sibling, '4', 'inferred', 2);

		expect(task?.[DEPENDENCY_SOURCES_KEY]).toEqual({
			'2.3': 'inferred',
			'4': 'inferred'
		});
	});

	it('reconcile treats numeric and dotted forms of one sibling as the same dependency', () => {
		const previous = {
			dependencies: [1],
			metadata: marks({ '2.1': 'inferred' })
		};

		const metadata = reconcileDependencySources(
			{ dependencies: ['2.1', '2.2'] },
			previous,
			2
		);

		expect(metadata?.[DEPENDENCY_SOURCES_KEY]).toEqual({
			'2.1': 'inferred',
			'2.2': 'inferred'
		});
	});

	it('reads back what reconcile writes for a sibling, another subtask and a task', () => {
		// Subtask of task 2: sibling 1, subtask 4.1, task 3, task 150
		const subtask = { dependencies: [1, '4.1', '3', 150] };
		const metadata = reconcileDependencySources(subtask, undefined, 2);
		const marked = { ...subtask, metadata };

		expect(metadata?.[DEPENDENCY_SOURCES_KEY]).toEqual({
			'2.1': 'inferred',
			'4.1': 'inferred',
			'3': 'inferred',
			'150': 'inferred'
		});
		for (const dep of subtask.dependencies) {
			expect(getDependencySource(marked, dep, 2)).toBe('inferred');
		}
		expect(getDependencySource(marked, '2.1', 2)).toBe('inferred');
		expect(getDependencySource(marked, 3, 2)).toBe('explicit');
	});

	it('an explicit set clears a mark even when the forms differ', () => {
		const metadata = setDependencySource(
			marks({ '2.1': 'inferred' }),
			1,
			'explicit',
			2
		);

		expect(metadata).toBeUndefined();
	});
});

describe('hasDependency under a parent', () => {
	it('tells a sibling number from a task string', () => {
		const subtask = { dependencies: [1, '3'] };

		expect(hasDependency(subtask, '2.1', 2)).toBe(true);
		expect(hasDependency(subtask, 1, 2)).toBe(true);
		expect(hasDependency(subtask, '1', 2)).toBe(false);
		expect(hasDependency(subtask, '3', 2)).toBe(true);
		expect(hasDependency(subtask, 3, 2)).toBe(false);
	});
});

describe('pruneDependencySources', () => {
	it('drops marks for dependencies no longer listed', () => {
		const metadata = pruneDependencySources({
			dependencies: [7],
			metadata: { keep: 1, ...marks({ '5': 'inferred', '7': 'inferred' }) }
		});

		expect(metadata).toEqual({ keep: 1, ...marks({ '7': 'inferred' }) });
	});

	it('returns undefined when nothing remains', () => {
		expect(
			pruneDependencySources({
				dependencies: [],
				metadata: marks({ '5': 'inferred' })
			})
		).toBeUndefined();
	});
});

describe('rekeyDependencySources', () => {
	it('moves sibling marks to the keys the new context reads', () => {
		const metadata = rekeyDependencySources(
			{ dependencies: [1], metadata: marks({ '2.1': 'inferred' }) },
			2,
			undefined
		);

		expect(metadata?.[DEPENDENCY_SOURCES_KEY]).toEqual({ '1': 'inferred' });
	});

	it('follows dependencies the move rewrote', () => {
		const metadata = rekeyDependencySources(
			{
				dependencies: ['7.1', 2],
				metadata: marks({ '7.1': 'inferred', '7.2': 'inferred' })
			},
			7,
			9,
			(dep) =>
				String(dep).startsWith('7.') ? String(dep).replace('7.', '9.') : dep
		);

		expect(metadata?.[DEPENDENCY_SOURCES_KEY]).toEqual({
			'9.1': 'inferred',
			'9.2': 'inferred'
		});
	});

	it('keeps other metadata and passes through when there are no marks', () => {
		const task = { dependencies: [1], metadata: { jira: 'A-1' } };

		expect(rekeyDependencySources(task, undefined, 3)).toEqual({ jira: 'A-1' });
	});
});

describe('assignMetadata', () => {
	it('sets metadata, or deletes the field when there is none', () => {
		const task: { metadata?: Record<string, unknown> } = {};

		assignMetadata(task, { a: 1 });
		expect(task.metadata).toEqual({ a: 1 });

		assignMetadata(task, undefined);
		expect(task).not.toHaveProperty('metadata');
	});
});
