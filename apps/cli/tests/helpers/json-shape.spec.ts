import { describe, expect, it } from 'vitest';
import { shapeOf } from './json-shape.js';

describe('shapeOf', () => {
	it('maps values to their types and keeps keys', () => {
		expect(shapeOf({ id: '1', n: 2, ok: true, none: null })).toEqual({
			id: 'string',
			n: 'number',
			ok: 'boolean',
			none: 'null'
		});
	});

	it('merges array elements, marking keys only some elements have', () => {
		expect(shapeOf([{ id: 1, extra: 'x' }, { id: 2 }])).toEqual([
			{ id: 'number', 'extra?': 'string' }
		]);
		expect(shapeOf([])).toEqual([]);
	});

	it('unions element types that differ', () => {
		expect(shapeOf(['a', 1, null])).toEqual(['null | number | string']);
	});

	it('treats a record key as a map keyed by data', () => {
		expect(
			shapeOf({ counts: { done: 1, pending: 2 } }, { records: ['counts'] })
		).toEqual({ counts: { '<key>': 'number' } });
	});

	it('lets an empty map take the shape of a full one', () => {
		expect(
			shapeOf([{ counts: {} }, { counts: { done: 1 } }], {
				records: ['counts']
			})
		).toEqual([{ counts: { '<key>': 'number' } }]);
	});
});
