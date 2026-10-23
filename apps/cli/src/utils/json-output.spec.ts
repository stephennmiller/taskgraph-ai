import { JSON_OUTPUT_SCHEMA_VERSION } from '@tm/core';
import { describe, expect, it } from 'vitest';
import { formatJson, wantsJsonOutput } from './json-output.js';

describe('formatJson', () => {
	it('stamps schemaVersion first, indented by default', () => {
		expect(formatJson({ found: true })).toBe(
			`{\n  "schemaVersion": ${JSON_OUTPUT_SCHEMA_VERSION},\n  "found": true\n}`
		);
	});

	it('prints one line when compact', () => {
		expect(formatJson({ success: false }, { compact: true })).toBe(
			`{"schemaVersion":${JSON_OUTPUT_SCHEMA_VERSION},"success":false}`
		);
	});
});

describe('wantsJsonOutput', () => {
	it.each([
		[['list', '--json']],
		[['next', '--format', 'json']],
		[['graph', '--format=json']],
		[['why', '5', '-f', 'json']],
		[['autopilot', 'status', '--json']],
		[['parse-prd', 'prd.md', '--clarify', '--json']]
	])('is true for %j', (args) => {
		expect(wantsJsonOutput(args)).toBe(true);
	});

	it.each([
		[['list']],
		[['next', '--format', 'text']],
		[['show', '1', '--format']],
		[['add-task', '--', '--json']],
		[[]]
	])('is false for %j', (args) => {
		expect(wantsJsonOutput(args)).toBe(false);
	});
});
