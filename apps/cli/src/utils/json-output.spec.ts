import {
	JSON_OUTPUT_SCHEMA_VERSION,
	type Task,
	buildDependencyTree,
	explainBlockers,
	neutralizeTaskData
} from '@tm/core';
import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	formatJson,
	jsonOption,
	printJson,
	wantsJsonOutput
} from './json-output.js';

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

describe('printJson', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('prints graph and why trees nested too deep for JSON.stringify (#822)', () => {
		const tasks = Array.from({ length: 5000 }, (_, i) => ({
			id: String(i + 1),
			title: `Task ${i + 1}`,
			status: 'pending',
			dependencies: i ? [String(i)] : [],
			subtasks: []
		})) as unknown as Task[];
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});

		// As `graph --json` and `why --json` print them (compact keeps the
		// text small: indented, a 5000-task chain is hundreds of MB)
		printJson(neutralizeTaskData(buildDependencyTree(tasks)), {
			compact: true
		});
		printJson(neutralizeTaskData(explainBlockers(tasks, '5000')), {
			compact: true
		});

		expect(JSON.parse(log.mock.calls[0][0]).total).toBe(5000);
		expect(JSON.parse(log.mock.calls[1][0]).blockers[0].id).toBe('4999');
	});

	it('prints output too long for one string as it goes, with the same text', () => {
		const payload = { a: 'x'.repeat(1 << 24), b: 'y' };
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});

		printJson(payload);

		expect(log.mock.calls.length).toBeGreaterThan(1);
		expect(log.mock.calls.map(([line]) => `${line}\n`).join('')).toBe(
			`${formatJson(payload)}\n`
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
