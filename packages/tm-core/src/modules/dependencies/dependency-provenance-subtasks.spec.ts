import { describe, expect, it } from 'vitest';
import {
	DEPENDENCY_SOURCES_KEY,
	assignMetadata,
	getDependencySource,
	pruneDependencySources,
	reconcileDependencySources,
	rekeyDependencySources,
	setDependencySource
} from './dependency-provenance.js';

const marks = (value: Record<string, string>) => ({
	[DEPENDENCY_SOURCES_KEY]: value
});

describe('subtask sibling ids', () => {
	it('reads a legacy numeric key for a dotted dependency under the parent', () => {
		const subtask = {
			dependencies: ['2.1'],
			metadata: marks({ '1': 'inferred' })
		};

		expect(getDependencySource(subtask, '2.1', 2)).toBe('inferred');
		expect(getDependencySource(subtask, 1, 2)).toBe('inferred');
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

	it('writes dotted keys and rewrites legacy numeric ones', () => {
		const metadata = setDependencySource(
			marks({ '1': 'inferred' }),
			3,
			'inferred',
			2
		);

		expect(metadata?.[DEPENDENCY_SOURCES_KEY]).toEqual({
			'2.1': 'inferred',
			'2.3': 'inferred'
		});
	});

	it('reconcile treats numeric and dotted forms of one sibling as the same dependency', () => {
		const previous = {
			dependencies: [1],
			metadata: marks({ '1': 'inferred' })
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

	it('an explicit set clears a mark even when the forms differ', () => {
		const metadata = setDependencySource(
			marks({ '1': 'inferred' }),
			'2.1',
			'explicit',
			2
		);

		expect(metadata).toBeUndefined();
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
