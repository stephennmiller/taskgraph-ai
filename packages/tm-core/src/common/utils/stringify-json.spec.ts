import { describe, expect, it } from 'vitest';
import { stringifyJson, writeJson } from './stringify-json.js';

/** A value nested `depth` levels deep, an object and an array per level */
function chain(depth: number) {
	let node: { id: string; children: unknown[] } = { id: '0', children: [] };
	for (let i = 1; i < depth; i++) node = { id: String(i), children: [node] };
	return node;
}

describe('stringifyJson', () => {
	const shared = { s: 'shared' };
	const nullProto = Object.assign(Object.create(null), { n: 1 });
	const value = {
		text: 'quote " backslash \\ newline \n esc \x1b[2J   é',
		numbers: [0, -0, 1.5, 1e21, Number.NaN, Number.POSITIVE_INFINITY],
		flags: [true, false, null],
		left: [undefined, () => 1, Symbol('s')],
		gone: undefined,
		fn: () => 1,
		date: new Date('2026-10-31T00:00:00.000Z'),
		keyed: { toJSON: (key: string) => `key was ${key}` },
		boxed: [Object(1), Object('s'), Object(false)],
		empty: { obj: {}, arr: [] },
		map: new Map([['a', 1]]),
		nullProto,
		protoKey: JSON.parse('{"__proto__": {"p": 1}}'),
		twice: [shared, shared],
		__proto__x: 1,
		'': 'empty key'
	};

	it.each([[undefined], [0], [2], [4], [20]])(
		'prints what JSON.stringify prints (indent %s)',
		(indent) => {
			expect(stringifyJson(value, { indent })).toBe(
				JSON.stringify(value, null, indent)
			);
		}
	);

	it('prints top-level primitives as JSON.stringify does', () => {
		for (const v of ['s', 1, null, true, undefined, () => 1]) {
			expect(stringifyJson(v)).toBe(JSON.stringify(v));
		}
	});

	it('maps every string and key before quoting', () => {
		const text = stringifyJson(
			{ a: ['x', { b: 'y' }], k: 1 },
			{ mapString: (s) => s.toUpperCase() }
		);

		expect(text).toBe('{"A":["X",{"B":"Y"}],"K":1}');
	});

	it('throws on a cycle and on a BigInt, as JSON.stringify does', () => {
		const loop: Record<string, unknown> = {};
		loop.self = loop;

		expect(() => stringifyJson(loop)).toThrow(TypeError);
		expect(() => stringifyJson({ n: 1n })).toThrow(TypeError);
	});

	it('prints indented nesting as JSON.stringify does', () => {
		const deep = chain(300);

		expect(stringifyJson(deep, { indent: 2 })).toBe(
			JSON.stringify(deep, null, 2)
		);
	});

	it('prints nesting too deep for JSON.stringify', () => {
		const deep = chain(5000);

		const text = stringifyJson(deep);

		expect(() => JSON.stringify(deep)).toThrow(RangeError);
		expect(text.startsWith('{"id":"4999","children":[{"id":"4998"')).toBe(true);
		expect(text.endsWith(`{"id":"0","children":[]}${']}'.repeat(4999)}`)).toBe(
			true
		);
	});

	it('hands out the text in order as it writes', () => {
		const chunks: string[] = [];

		const wrote = writeJson({ a: [1, { b: 2 }] }, { indent: 2 }, (c) =>
			chunks.push(c)
		);

		expect(wrote).toBe(true);
		expect(chunks.length).toBeGreaterThan(1);
		expect(chunks.join('')).toBe(JSON.stringify({ a: [1, { b: 2 }] }, null, 2));
		expect(writeJson(undefined, {}, (c) => chunks.push(c))).toBe(false);
	});
});
