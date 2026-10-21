import { describe, expect, it } from 'vitest';
import {
	DEPENDENCY_SOURCES_KEY,
	getDependencySource,
	reconcileDependencySources,
	renameDependencySource,
	setDependencySource
} from './dependency-provenance.js';

describe('renameDependencySource handing the source to the new id', () => {
	it('drops a mark already under the new id when the old id is explicit', () => {
		const metadata = renameDependencySource(
			{ [DEPENDENCY_SOURCES_KEY]: { '5': 'inferred' } },
			7,
			5
		);

		expect(metadata).toBeUndefined();
	});

	it('gives the new id the old id source when both had marks', () => {
		const metadata = renameDependencySource(
			{ [DEPENDENCY_SOURCES_KEY]: { '7': 'inferred', '5': 'inferred' } },
			7,
			5
		);

		expect(metadata?.[DEPENDENCY_SOURCES_KEY]).toEqual({ '5': 'inferred' });
	});
});

describe('getDependencySource', () => {
	it('treats a dependency with no recorded source as explicit', () => {
		expect(getDependencySource({ dependencies: [1] }, 1)).toBe('explicit');
	});

	it('reads an inferred entry regardless of number or string id', () => {
		const task = {
			dependencies: [2],
			metadata: { [DEPENDENCY_SOURCES_KEY]: { '2': 'inferred' } }
		};
		expect(getDependencySource(task, 2)).toBe('inferred');
		expect(getDependencySource(task, '2')).toBe('inferred');
	});

	it('ignores an entry whose dependency is no longer listed', () => {
		const task = {
			dependencies: [],
			metadata: { [DEPENDENCY_SOURCES_KEY]: { '2': 'inferred' } }
		};
		expect(getDependencySource(task, 2)).toBe('explicit');
	});

	it('falls back to explicit when the stored value is malformed', () => {
		const task = {
			dependencies: [2],
			metadata: { [DEPENDENCY_SOURCES_KEY]: 'garbage' }
		};
		expect(getDependencySource(task, 2)).toBe('explicit');
	});
});

describe('reconcileDependencySources', () => {
	it('marks every dependency of a brand-new AI task as inferred', () => {
		const metadata = reconcileDependencySources({ dependencies: [1, 2] });

		expect(metadata?.[DEPENDENCY_SOURCES_KEY]).toEqual({
			'1': 'inferred',
			'2': 'inferred'
		});
	});

	it('keeps existing dependencies as they were and marks new ones inferred', () => {
		const previous = { dependencies: [1] };

		const metadata = reconcileDependencySources(
			{ dependencies: [1, 3] },
			previous
		);

		expect(metadata?.[DEPENDENCY_SOURCES_KEY]).toEqual({ '3': 'inferred' });
	});

	it('keeps an earlier inferred mark when the AI keeps the dependency', () => {
		const previous = {
			dependencies: [1],
			metadata: { [DEPENDENCY_SOURCES_KEY]: { '1': 'inferred' } }
		};

		const metadata = reconcileDependencySources(
			{ dependencies: [1] },
			previous
		);

		expect(metadata?.[DEPENDENCY_SOURCES_KEY]).toEqual({ '1': 'inferred' });
	});

	it('drops entries for dependencies the AI removed', () => {
		const previous = {
			dependencies: [1, 2],
			metadata: {
				[DEPENDENCY_SOURCES_KEY]: { '1': 'inferred', '2': 'inferred' }
			}
		};

		const metadata = reconcileDependencySources(
			{ dependencies: [2] },
			previous
		);

		expect(metadata?.[DEPENDENCY_SOURCES_KEY]).toEqual({ '2': 'inferred' });
	});

	it('preserves unrelated user metadata and omits the key when nothing is inferred', () => {
		const previous = {
			dependencies: [1],
			metadata: {
				jira: 'ABC-1',
				[DEPENDENCY_SOURCES_KEY]: { '1': 'inferred' }
			}
		};

		const metadata = reconcileDependencySources({ dependencies: [] }, previous);

		expect(metadata).toEqual({ jira: 'ABC-1' });
	});

	it('returns undefined metadata when there is nothing to record', () => {
		const metadata = reconcileDependencySources(
			{ dependencies: [1] },
			{ dependencies: [1] }
		);

		expect(metadata).toBeUndefined();
	});

	it('does not mutate its inputs', () => {
		const previous = { dependencies: [1], metadata: { a: 1 } };

		reconcileDependencySources({ dependencies: [1, 2] }, previous);

		expect(previous).toEqual({ dependencies: [1], metadata: { a: 1 } });
	});
});

describe('setDependencySource', () => {
	it('records inferred', () => {
		const metadata = setDependencySource(undefined, 4, 'inferred');

		expect(metadata?.[DEPENDENCY_SOURCES_KEY]).toEqual({ '4': 'inferred' });
	});

	it('explicit clears an inferred mark and removes the empty key', () => {
		const metadata = setDependencySource(
			{ keep: true, [DEPENDENCY_SOURCES_KEY]: { '4': 'inferred' } },
			4,
			'explicit'
		);

		expect(metadata).toEqual({ keep: true });
	});
});

describe('renameDependencySource', () => {
	it('moves the mark to the new id', () => {
		const metadata = renameDependencySource(
			{ [DEPENDENCY_SOURCES_KEY]: { '2': 'inferred' } },
			2,
			5
		);

		expect(metadata?.[DEPENDENCY_SOURCES_KEY]).toEqual({ '5': 'inferred' });
	});

	it('leaves metadata without a mark for the old id untouched', () => {
		const metadata = { other: 1 };

		expect(renameDependencySource(metadata, 2, 5)).toEqual({ other: 1 });
	});
});
