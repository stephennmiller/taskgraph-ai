import { describe, expect, it } from 'vitest';
import { JSON_OUTPUT_SCHEMA_VERSION, toVersionedJson } from './json-output.js';

describe('toVersionedJson', () => {
	it('puts schemaVersion first and keeps the payload', () => {
		const result = toVersionedJson({ task: { id: '1' }, found: true });

		expect(Object.keys(result)).toEqual(['schemaVersion', 'task', 'found']);
		expect(result).toEqual({
			schemaVersion: JSON_OUTPUT_SCHEMA_VERSION,
			task: { id: '1' },
			found: true
		});
	});

	it("does not let the payload's own schemaVersion replace the output version", () => {
		const result = toVersionedJson({ schemaVersion: 99, tag: 'master' });

		expect(result.schemaVersion).toBe(JSON_OUTPUT_SCHEMA_VERSION);
		expect(Object.keys(result)).toEqual(['schemaVersion', 'tag']);
	});

	it('leaves the payload object unchanged', () => {
		const payload = { tag: 'master' };

		toVersionedJson(payload);

		expect(payload).toEqual({ tag: 'master' });
	});

	it('refuses a bare array', () => {
		expect(() => toVersionedJson([1, 2])).toThrow(TypeError);
	});
});
