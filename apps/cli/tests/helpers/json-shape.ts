/**
 * @fileoverview The shape of a JSON value: its keys and value types, without
 * the values. The --json contract tests pin these shapes.
 *
 *  - a primitive becomes its type name: "string", "number", "boolean", "null"
 *  - an object keeps its keys, each mapped to the shape of its value
 *  - an array becomes `[shape]`, the elements' shapes merged into one
 *    (`[]` when empty); a key missing from some elements ends in `?`
 *  - values of different types merge to a union such as "null | string"
 *  - an object under one of the `records` keys is a map whose keys are data
 *    (such as counts by status): it becomes `{ "<key>": shape }`
 */

type Shape = string | Shape[] | { [key: string]: Shape };

const isObject = (shape: Shape): shape is { [key: string]: Shape } =>
	typeof shape === 'object' && !Array.isArray(shape);

function kind(shape: Shape): string {
	if (Array.isArray(shape)) return 'array';
	if (isObject(shape)) return 'object';
	return shape;
}

function union(...parts: string[]): string {
	return [...new Set(parts.flatMap((p) => p.split(' | ')))].sort().join(' | ');
}

function mergeObjects(
	a: { [key: string]: Shape },
	b: { [key: string]: Shape }
): { [key: string]: Shape } {
	const strip = (key: string) => key.replace(/\?$/, '');
	const find = (obj: { [key: string]: Shape }, key: string) =>
		Object.keys(obj).find((k) => strip(k) === key);
	const keys = [...new Set([...Object.keys(a), ...Object.keys(b)].map(strip))];
	const merged: { [key: string]: Shape } = {};
	for (const key of keys) {
		const ka = find(a, key);
		const kb = find(b, key);
		const optional =
			!ka || !kb || ka.endsWith('?') || (kb?.endsWith('?') ?? false);
		const value =
			ka && kb ? mergeShapes(a[ka], b[kb]) : ka ? a[ka] : b[kb as string];
		merged[optional ? `${key}?` : key] = value;
	}
	return merged;
}

const isRecordShape = (shape: Shape) =>
	isObject(shape) && Object.keys(shape).join() === '<key>';
const isEmptyObject = (shape: Shape) =>
	isObject(shape) && Object.keys(shape).length === 0;

function mergeShapes(a: Shape, b: Shape): Shape {
	// An empty map says nothing about the shape of its values
	if (isEmptyObject(a) && isRecordShape(b)) return b;
	if (isEmptyObject(b) && isRecordShape(a)) return a;
	if (isObject(a) && isObject(b)) return mergeObjects(a, b);
	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length === 0) return b;
		if (b.length === 0) return a;
		return [mergeShapes(a[0], b[0])];
	}
	if (typeof a === 'string' && typeof b === 'string') return union(a, b);
	return union(kind(a), kind(b));
}

/**
 * The shape of a parsed JSON value
 * @param options.records - Keys whose object value is a map keyed by data
 */
export function shapeOf(
	value: unknown,
	options: { records?: string[] } = {}
): Shape {
	const records = new Set(options.records ?? []);
	const walk = (v: unknown, isRecord = false): Shape => {
		if (v === null) return 'null';
		if (Array.isArray(v)) {
			if (v.length === 0) return [];
			return [v.map((item) => walk(item)).reduce(mergeShapes)];
		}
		if (typeof v === 'object') {
			const entries = Object.entries(v as Record<string, unknown>);
			if (isRecord) {
				if (entries.length === 0) return {};
				const values = entries.map(([, item]) => walk(item));
				return { '<key>': values.reduce(mergeShapes) };
			}
			return Object.fromEntries(
				entries.map(([k, item]) => [k, walk(item, records.has(k))])
			);
		}
		return typeof v;
	};
	return walk(value);
}
