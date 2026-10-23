import { JSON_OUTPUT_SCHEMA_VERSION } from '@tm/core';
import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { formatJson, jsonOption, wantsJsonOutput } from './json-output.js';

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
		[['github', 'status', '--json']],
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

describe('jsonOption', () => {
	const formatFor = (args: string[]): string => {
		const command = new Command('demo')
			.option('-f, --format <format>', 'Output format (text, json)', 'text')
			.addOption(jsonOption())
			.action(() => {});
		command.parse(args, { from: 'user' });
		return command.opts().format;
	};

	it('sets --format to json', () => {
		expect(formatFor(['--json'])).toBe('json');
	});

	it('leaves the default format without it', () => {
		expect(formatFor([])).toBe('text');
	});

	it('gives way to a --format typed alongside it', () => {
		expect(formatFor(['--json', '--format', 'text'])).toBe('text');
	});
});
