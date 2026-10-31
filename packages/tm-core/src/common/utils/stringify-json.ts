/**
 * @fileoverview `JSON.stringify` without recursion
 *
 * Node's own `JSON.stringify` recurses once per nesting level and throws
 * "Maximum call stack size exceeded" at a depth of about 2500. The dependency
 * tree and blocker explanation nest one level per task in a chain (#822), so
 * `--json` output goes through this copy, which walks an explicit stack and
 * hands its text out in order, piece by piece.
 */

export interface StringifyJsonOptions {
	/** Spaces per indent level, as `JSON.stringify`'s `space` (at most 10) */
	indent?: number;
	/** Applied to every string, keys included, before it's quoted */
	mapString?: (text: string) => string;
}

interface Frame {
	source: object;
	/** Object keys; null for an array */
	keys: string[] | null;
	length: number;
	next: number;
	/** Whether a member has been written yet */
	wrote: boolean;
	/** Indent of this frame's members */
	indent: string;
}

/**
 * The same text as `JSON.stringify(value, null, indent)` (`toJSON`, boxed
 * primitives, left-out `undefined` and functions, `null` for them in arrays,
 * a TypeError on a cycle or a BigInt), at any nesting depth.
 */
export function stringifyJson(
	value: unknown,
	options: StringifyJsonOptions = {}
): string {
	const chunks: string[] = [];
	const written = writeJson(value, options, (chunk) => chunks.push(chunk));
	// Undefined, as JSON.stringify gives, for a value JSON leaves out
	return (written ? chunks.join('') : undefined) as string;
}

/**
 * `stringifyJson`, passing the text to `write` in order as it goes, so a
 * caller can print output too long for one string. False when `value` is
 * one JSON leaves out (undefined, a function), and nothing was written.
 */
export function writeJson(
	value: unknown,
	options: StringifyJsonOptions,
	write: (chunk: string) => void
): boolean {
	const gap = ' '.repeat(Math.max(0, Math.min(10, options.indent ?? 0)));
	const map = options.mapString;
	const quote = (text: string) => JSON.stringify(map ? map(text) : text);
	const stack: Frame[] = [];
	const open = new Set<object>();

	// A value's text, a frame to fill for an object or array, or undefined
	// for a value JSON leaves out
	const begin = (
		item: unknown,
		key: string,
		indent: string
	): string | Frame | undefined => {
		if (
			(typeof item === 'object' && item !== null) ||
			typeof item === 'function' ||
			typeof item === 'bigint'
		) {
			const toJSON = (item as { toJSON?: unknown }).toJSON;
			if (typeof toJSON === 'function') item = toJSON.call(item, key);
		}
		if (item instanceof Number) item = Number(item);
		else if (item instanceof String) item = String(item);
		else if (item instanceof Boolean || item instanceof BigInt)
			item = item.valueOf();

		if (typeof item === 'string') return quote(item);
		// Numbers, booleans and null; undefined for functions and symbols;
		// throws for a BigInt
		if (item === null || typeof item !== 'object') return JSON.stringify(item);
		if (open.has(item)) {
			throw new TypeError('Converting circular structure to JSON');
		}
		open.add(item);
		const keys = Array.isArray(item) ? null : Object.keys(item);
		return {
			source: item,
			keys,
			length: keys ? keys.length : (item as unknown[]).length,
			next: 0,
			wrote: false,
			indent: indent + gap
		};
	};

	const enter = (frame: Frame) => {
		write(frame.keys ? '{' : '[');
		stack.push(frame);
	};

	const root = begin(value, '', '');
	if (root === undefined) return false;
	if (typeof root === 'string') {
		write(root);
		return true;
	}
	enter(root);
	while (stack.length) {
		const frame = stack[stack.length - 1];
		if (frame.next < frame.length) {
			const index = frame.next++;
			const key = frame.keys ? frame.keys[index] : String(index);
			const child = begin(
				(frame.source as Record<string, unknown>)[key],
				key,
				frame.indent
			);
			// An object leaves the member out; an array writes null
			if (child === undefined && frame.keys) continue;
			const lead = gap ? `\n${frame.indent}` : '';
			write(frame.wrote ? `,${lead}` : lead);
			frame.wrote = true;
			if (frame.keys) write(`${quote(key)}:${gap ? ' ' : ''}`);
			if (typeof child === 'object') enter(child);
			else write(child ?? 'null');
			continue;
		}
		stack.pop();
		open.delete(frame.source);
		const outer =
			frame.wrote && gap ? `\n${frame.indent.slice(gap.length)}` : '';
		write(outer + (frame.keys ? '}' : ']'));
	}
	return true;
}
