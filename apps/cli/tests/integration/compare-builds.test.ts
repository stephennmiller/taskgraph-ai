/**
 * @fileoverview Tests for the build comparison tool (tests/parity): it runs
 * one scenario against two builds of the CLI and reports differences in exit
 * codes and in the normalized files under .taskgraph/.
 *
 * The end-to-end cases need the build (`npm run build`) and skip without it.
 *
 * @integration
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getCliBinPath } from '../helpers/test-utils.js';
import {
	buildEnv,
	compareRuns,
	diffSnapshots,
	formatReport,
	runScenario,
	summarizeRun,
	unexpectedExits,
	validateScenario
} from '../parity/compare-builds.mjs';
import { normalizeSnapshot } from '../parity/normalize.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const compareScript = path.resolve(here, '../parity/compare-builds.mjs');
const fixture = path.resolve(here, '../parity/fixtures/tasks-tagged.json');
const cli = getCliBinPath();
const built = fs.existsSync(cli);
if (!built && process.env.CI) {
	throw new Error(
		`${cli} is missing; run npm run build before these tests in CI`
	);
}

const ctx = { projectDir: '/tmp/proj-a', workDir: '/tmp/work-a' };

describe('normalizeSnapshot', () => {
	it('replaces timestamps, in JSON values and in plain text', () => {
		const json = normalizeSnapshot(
			'tasks.json',
			JSON.stringify({ created: '2026-10-22T12:44:17.851Z' }),
			ctx
		);
		const text = normalizeSnapshot(
			'task_001.txt',
			'Updated 2026-10-22T12:44:17.851Z today',
			ctx
		);

		expect(JSON.parse(json)).toEqual({ created: '<timestamp>' });
		expect(text).toBe('Updated <timestamp> today');
	});

	it('drops schemaVersion inside metadata only', () => {
		const out = normalizeSnapshot(
			'tasks.json',
			JSON.stringify({
				schemaVersion: 1,
				master: {
					metadata: { schemaVersion: 2, keep: 1 },
					tasks: [{ id: 1, schemaVersion: 3 }]
				}
			}),
			ctx
		);

		expect(JSON.parse(out)).toEqual({
			schemaVersion: 1,
			master: { metadata: { keep: 1 }, tasks: [{ id: 1, schemaVersion: 3 }] }
		});
	});

	it('writes keys in sorted order, so key order never shows as a difference', () => {
		const a = normalizeSnapshot('x.json', '{"b":1,"a":{"d":1,"c":2}}', ctx);
		const b = normalizeSnapshot('x.json', '{"a":{"c":2,"d":1},"b":1}', ctx);

		expect(a).toBe(b);
	});

	it('replaces the project and work directories with placeholders', () => {
		const out = normalizeSnapshot(
			'config.json',
			JSON.stringify({ p: '/tmp/work-a/bin/claude', q: '/tmp/proj-a/x' }),
			ctx
		);

		expect(JSON.parse(out)).toEqual({
			p: '<work>/bin/claude',
			q: '<project>/x'
		});
	});

	it('keeps array order and real values', () => {
		const out = normalizeSnapshot(
			'x.json',
			'{"tasks":[{"id":2},{"id":1}]}',
			ctx
		);

		expect(JSON.parse(out)).toEqual({ tasks: [{ id: 2 }, { id: 1 }] });
	});

	describe('MCP replies', () => {
		it('masks version and locale dates, and keeps every other value', () => {
			const out = normalizeSnapshot(
				'mcp-reply.json',
				JSON.stringify({
					version: { version: '0.54.14', name: 'taskgraph-ai' },
					data: { copiedAt: '10/22/2026', message: 'Copied 3 tasks' }
				}),
				ctx
			);

			expect(JSON.parse(out)).toEqual({
				version: '<version>',
				data: { copiedAt: '<date>', message: 'Copied 3 tasks' }
			});
		});

		it('masks only the top-level version, not one nested in the data', () => {
			const out = normalizeSnapshot(
				'mcp-reply.json',
				JSON.stringify({ version: '1', data: { version: '2' } }),
				ctx
			);

			expect(JSON.parse(out)).toEqual({
				version: '<version>',
				data: { version: '2' }
			});
		});

		it('masks the Version and Name footer of a plain-text error reply', () => {
			const out = normalizeSnapshot(
				'mcp-reply.txt',
				'Error: no such task\nVersion: 0.54.14\nName: taskgraph-ai',
				ctx
			);

			expect(out).toBe('Error: no such task\n<version footer>');
		});

		it('leaves a version key in other files and in tool schemas alone', () => {
			const tasks = normalizeSnapshot('tasks.json', '{"version":"1"}', ctx);
			const schema = normalizeSnapshot(
				'mcp-tools.json',
				'{"version":"1"}',
				ctx
			);

			expect(JSON.parse(tasks)).toEqual({ version: '1' });
			expect(JSON.parse(schema)).toEqual({ version: '1' });
		});
	});
});

describe('diffSnapshots', () => {
	it('returns nothing for identical snapshots', () => {
		expect(diffSnapshots({ 'a.json': '{}' }, { 'a.json': '{}' })).toEqual([]);
	});

	it('names a file whose content differs and shows the changed lines', () => {
		const [diff] = diffSnapshots(
			{ 'a.json': 'one\ntwo\n' },
			{ 'a.json': 'one\n2\n' }
		);

		expect(diff.file).toBe('a.json');
		expect(diff.kind).toBe('changed');
		expect(diff.diff).toContain('-two');
		expect(diff.diff).toContain('+2');
	});

	it('ignores a diff tool set in the environment', () => {
		const saved = process.env.GIT_EXTERNAL_DIFF;
		process.env.GIT_EXTERNAL_DIFF = 'true';
		try {
			const [diff] = diffSnapshots(
				{ 'a.json': 'one\ntwo\n' },
				{ 'a.json': 'one\n2\n' }
			);

			expect(diff.diff).toContain('-two');
		} finally {
			if (saved === undefined) delete process.env.GIT_EXTERNAL_DIFF;
			else process.env.GIT_EXTERNAL_DIFF = saved;
		}
	});

	it('reports a file that exists on one side only', () => {
		const diffs = diffSnapshots({ 'a.json': '{}' }, { 'b.json': '{}' });

		expect(diffs.map((d) => [d.file, d.kind])).toEqual([
			['a.json', 'only-in-a'],
			['b.json', 'only-in-b']
		]);
	});
});

describe('compareRuns and formatReport', () => {
	const step = (
		files: Record<string, string>,
		status: number | null = 0,
		extra: object = {}
	) => ({ args: ['cmd'], status, files, ...extra });
	const run = (...steps: ReturnType<typeof step>[]) => ({ steps });

	it('finds nothing in identical runs', () => {
		const a = run(step({ 'f.json': '1' }), step({ 'f.json': '2' }));

		expect(compareRuns(a, structuredClone(a))).toEqual([]);
	});

	it('reports a divergence once, not again at every later step', () => {
		const a = run(
			step({ 'f.json': '1' }),
			step({ 'f.json': '2' }),
			step({ 'f.json': '2' })
		);
		const b = run(
			step({ 'f.json': '1' }),
			step({ 'f.json': '9' }),
			step({ 'f.json': '9' })
		);

		const diffs = compareRuns(a, b);

		expect(diffs.map((d) => [d.step, d.kind])).toEqual([[1, 'f.json']]);
	});

	it('reports a new divergence at the step where it appears', () => {
		const a = run(
			step({ 'f.json': '1' }),
			step({ 'f.json': '2' }),
			step({ 'f.json': '3' })
		);
		const b = run(
			step({ 'f.json': '1' }),
			step({ 'f.json': '9' }),
			step({ 'f.json': '8' })
		);

		const diffs = compareRuns(a, b);

		expect(diffs.map((d) => d.step)).toEqual([1, 2]);
	});

	it('reports an exit code difference with the stderr of both builds', () => {
		const a = run(step({}), step({}, 0));
		const b = run(step({}), step({}, 1, { stderr: 'boom: bad flag' }));

		const [diff] = compareRuns(a, b);

		expect(diff.kind).toBe('exit code');
		expect(diff.detail).toContain('A exited 0');
		expect(diff.detail).toContain('B exited 1');
		expect(diff.detail).toContain('boom: bad flag');
	});

	it('says how a step ended when it has no exit code', () => {
		const a = run(step({}), step({}, 0));
		const b = run(step({}), step({}, null, { error: 'ETIMEDOUT' }));

		const [diff] = compareRuns(a, b);

		expect(diff.detail).toContain('ETIMEDOUT');
	});

	it('names the step and its arguments in the report', () => {
		const report = formatReport(
			[
				{
					step: 3,
					args: ['set-status', '--id=1'],
					kind: 'tasks.json',
					detail: '-a\n+b'
				}
			],
			10,
			{ a: 'build-a', b: 'build-b' }
		);

		expect(report).toContain('Step 3: set-status --id=1');
		expect(report).toContain('tasks.json');
		expect(report).toContain('1 difference(s) in 10 steps');
	});

	it('says plainly when there are no differences', () => {
		expect(formatReport([], 5, { a: 'x', b: 'y' })).toContain(
			'No differences in 5 steps'
		);
	});
});

describe('scenario files', () => {
	const dir = path.resolve(here, '../parity/scenarios');
	const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));

	it('has the default scenario and the edge cases', () => {
		expect(files).toEqual(
			expect.arrayContaining([
				'basic.json',
				'edge-bulk-update.json',
				'edge-cancelled-dependency.json',
				'edge-stale-lock.json'
			])
		);
	});

	it.each(files)('%s is well-formed', (file) => {
		const scenarioJson = JSON.parse(
			fs.readFileSync(path.join(dir, file), 'utf8')
		);

		expect(fs.existsSync(path.resolve(dir, scenarioJson.fixture))).toBe(true);
		expect(() => validateScenario(scenarioJson)).not.toThrow();
	});

	it('keeps the real npm cache and user config, so npx does not download again', () => {
		const env = buildEnv('/tmp/work-x', { HOME: '/home/dev' });

		expect(env.npm_config_cache).toBe('/home/dev/.npm');
		expect(env.npm_config_userconfig).toBe('/home/dev/.npmrc');
	});

	it('respects an npm cache set in the environment', () => {
		const env = buildEnv('/tmp/work-x', {
			HOME: '/home/dev',
			npm_config_cache: '/cache/npm'
		});

		expect(env.npm_config_cache).toBe('/cache/npm');
	});
});

describe('validateScenario', () => {
	const ok = { fixture: 'f.json', steps: [['list']] };

	it('accepts argument lists, capture steps and shell steps', () => {
		expect(() =>
			validateScenario({
				...ok,
				steps: [
					['list'],
					{ args: ['next', '--format', 'json'], capture: 'stdout' },
					{ shell: 'true' },
					{ args: ['set-status', '--id=99'], expectExit: 1 }
				]
			})
		).not.toThrow();
	});

	it('accepts an mcp step with and without input and expectError', () => {
		expect(() =>
			validateScenario({
				...ok,
				steps: [
					{ mcp: 'get_tasks' },
					{ mcp: 'get_task', input: { id: '1' }, expectError: true }
				]
			})
		).not.toThrow();
	});

	it.each([
		['no steps', { steps: [] }, /steps/],
		[
			'a step without args or shell',
			{ steps: [{ capture: 'stdout' }] },
			/Step 1.*args/
		],
		['a non-string argument', { steps: [['list', 3]] }, /Step 1.*strings/],
		[
			'capture on a shell step',
			{ steps: [{ shell: 'true', capture: 'stdout' }] },
			/Step 1.*capture/
		],
		['an unknown key', { steps: [{ args: ['list'], arg: 1 }] }, /Step 1.*arg/],
		[
			'a bad expectExit',
			{ steps: [{ args: ['list'], expectExit: 'no' }] },
			/Step 1.*expectExit/
		],
		['a bad replies value', { steps: [['list']], replies: 5 }, /replies/],
		[
			'mcp with args',
			{ steps: [{ mcp: 'get_tasks', args: ['list'] }] },
			/Step 1.*mcp/
		],
		[
			'mcp with shell',
			{ steps: [{ mcp: 'get_tasks', shell: 'true' }] },
			/Step 1.*mcp/
		],
		[
			'mcp with capture',
			{ steps: [{ mcp: 'get_tasks', capture: 'stdout' }] },
			/Step 1.*mcp/
		],
		[
			'mcp with expectExit',
			{ steps: [{ mcp: 'get_tasks', expectExit: 1 }] },
			/Step 1.*expectError/
		],
		['an empty mcp tool name', { steps: [{ mcp: '' }] }, /Step 1.*tool/],
		[
			'an input that is not an object',
			{ steps: [{ mcp: 'get_tasks', input: ['x'] }] },
			/Step 1.*input/
		],
		[
			'input on a step that is not mcp',
			{ steps: [{ args: ['list'], input: {} }] },
			/Step 1.*input/
		],
		[
			'expectError that is not a boolean',
			{ steps: [{ mcp: 'get_tasks', expectError: 1 }] },
			/Step 1.*expectError/
		]
	])('rejects %s, naming the step', (_name, scenario, message) => {
		expect(() => validateScenario(scenario)).toThrow(message);
	});
});

describe('unexpectedExits', () => {
	const step = (status: number | null, expected = 0) => ({
		args: ['cmd'],
		status,
		expected,
		files: {}
	});

	it('lists a step that exited differently than the scenario expects', () => {
		const run = { steps: [step(0), step(0), step(1), step(1, 1)] };

		expect(unexpectedExits(run)).toEqual([
			{ step: 2, args: ['cmd'], status: 1, expected: 0 }
		]);
	});

	it('treats a missing exit code as unexpected', () => {
		expect(unexpectedExits({ steps: [step(0), step(null)] })).toHaveLength(1);
	});
});

describe('summarizeRun', () => {
	const step = (status: number, files: Record<string, string>) => ({
		args: ['x'],
		status,
		files
	});

	it('counts steps, failed steps and steps that changed state', () => {
		const summary = summarizeRun({
			steps: [
				step(0, { 'a.json': '1' }), // setup, not counted
				step(0, { 'a.json': '1' }), // no change
				step(0, { 'a.json': '2' }), // changed
				step(1, { 'a.json': '2', 'b.json': '1' }), // failed, new file
				step(0, { 'a.json': '2', 'b.json': '1' }) // no change
			]
		});

		expect(summary).toEqual({ steps: 4, failed: 1, changedState: 2 });
	});

	it('does not count captured output as a changed file', () => {
		const summary = summarizeRun({
			steps: [
				step(0, { 'a.json': '1' }),
				step(0, { 'a.json': '1', 'stdout:1': '{}' }),
				step(0, { 'a.json': '1' })
			]
		});

		expect(summary.changedState).toBe(0);
	});
});

describe.skipIf(!built)('compare-builds script', () => {
	let work: string;

	beforeEach(() => {
		work = fs.mkdtempSync(path.join(os.tmpdir(), 'compare-builds-'));
	});

	afterEach(() => {
		fs.rmSync(work, { recursive: true, force: true });
	});

	const scenario = (steps: unknown[], extra: object = {}) => {
		const file = path.join(work, 'scenario.json');
		fs.writeFileSync(
			file,
			JSON.stringify({ fixture, steps, ...extra }, null, 2)
		);
		return file;
	};

	/** A build that runs the real CLI, then runs `after` in the project. */
	const wrapped = (after: string, exitCode?: number) => {
		const file = path.join(work, 'wrapped.sh');
		fs.writeFileSync(
			file,
			`#!/bin/sh\nnode "${cli}" "$@"\nrc=$?\n${after}\n${exitCode === undefined ? 'exit $rc' : `[ "$1" = init ] && exit $rc\nexit ${exitCode}`}\n`,
			{ mode: 0o755 }
		);
		return file;
	};

	const compare = (a: string, b: string, scenarioFile: string) =>
		spawnSync(
			process.execPath,
			[compareScript, '--a', a, '--b', b, '--scenario', scenarioFile],
			{
				encoding: 'utf8',
				timeout: 120000,
				env: { ...process.env, TASKGRAPH_SKIP_AUTO_UPDATE: '1' }
			}
		);

	const real = `node "${cli}"`;

	it('finds no differences when the same build is run twice', () => {
		const file = scenario([
			['set-status', '--id=1', '--status=in-progress'],
			['add-task', '--prompt', 'Write a hello world']
		]);

		const res = compare(real, real, file);

		expect(res.status, res.stdout + res.stderr).toBe(0);
		expect(res.stdout).toContain('No differences');
		expect(res.stdout).toMatch(/2 steps, 0 failed, 2 changed state/);
	});

	it('reports a difference in a file on disk', () => {
		const file = scenario([['set-status', '--id=1', '--status=in-progress']]);
		const changed = wrapped(
			`sed -i.bak 's/"in-progress"/"review"/' .taskgraph/tasks/tasks.json && rm -f .taskgraph/tasks/tasks.json.bak`
		);

		const res = compare(real, changed, file);

		expect(res.status).toBe(1);
		expect(res.stdout).toContain('tasks.json');
		expect(res.stdout).toContain('review');
	});

	it('reports a difference in exit code', () => {
		const file = scenario([['set-status', '--id=1', '--status=in-progress']]);

		const res = compare(real, wrapped(':', 3), file);

		expect(res.status).toBe(1);
		expect(res.stdout).toMatch(/exit code/i);
	});
	it('exits 2 with a clear message when a build cannot run init', () => {
		const file = scenario([['set-status', '--id=1', '--status=done']]);

		const res = compare('node dist/does-not-exist.js', real, file);

		expect(res.status).toBe(2);
		expect(res.stderr).toContain('could not run init');
		expect(res.stderr).toContain('absolute');
	});

	it('exits 2 for a scenario file that is not JSON', () => {
		const file = path.join(work, 'bad.json');
		fs.writeFileSync(file, '{ not json');

		const res = compare(real, real, file);

		expect(res.status).toBe(2);
		expect(res.stderr).toContain('bad.json');
	});

	it('shows what the failing build printed on stderr', () => {
		const file = scenario([['set-status', '--id=1', '--status=in-progress']]);
		const failing = wrapped('echo "boom: refused" >&2', 3);

		const res = compare(real, failing, file);

		expect(res.status).toBe(1);
		expect(res.stdout).toContain('boom: refused');
	});
	it("records a step's output when the scenario asks for it", () => {
		const run = runScenario(real, {
			fixture,
			steps: [
				{ args: ['next', '--format', 'json'], capture: 'stdout' },
				['next']
			]
		});

		const captured = JSON.parse(run.steps[1].files['stdout:1']);
		expect(captured.task.id).toBe('2');
		expect(Object.keys(run.steps[2].files)).not.toContain('stdout:2');
	});

	it('runs a shell step in the project, then the steps after it see its effect', () => {
		const run = runScenario(real, {
			fixture,
			steps: [
				{ shell: 'echo prepared > .taskgraph/tasks/marker.txt' },
				['list']
			]
		});

		expect(run.steps[1].status).toBe(0);
		expect(run.steps[1].files['.taskgraph/tasks/marker.txt']).toBe(
			'prepared\n'
		);
		expect(run.steps[1].args).toEqual([
			'shell',
			'echo prepared > .taskgraph/tasks/marker.txt'
		]);
	});

	it('reports a difference in a captured output', () => {
		const file = scenario([
			{ args: ['next', '--format', 'json'], capture: 'stdout' }
		] as any);
		const noisy = wrapped('[ "$1" = next ] && echo extra-line');

		const res = compare(real, noisy, file);

		expect(res.status).toBe(1);
		expect(res.stdout).toContain('stdout:1');
		expect(res.stdout).toContain('extra-line');
	});
	it('fails when a step does not exit as expected, even if both builds agree', () => {
		const file = scenario([['set-status', '--id=99', '--status=done']]);

		const res = compare(real, real, file);

		expect(res.status).toBe(1);
		expect(res.stdout).toContain('did not exit as expected');
		expect(res.stdout).toContain('set-status --id=99');
	});

	it('accepts a step that is meant to fail when the scenario says so', () => {
		const file = scenario([
			{ args: ['set-status', '--id=99', '--status=done'], expectExit: 1 }
		]);

		const res = compare(real, real, file);

		expect(res.status, res.stdout + res.stderr).toBe(0);
	});

	it('rejects a scenario with a malformed step before running anything', () => {
		const file = scenario([{ capture: 'stdout' }]);

		const res = compare(real, real, file);

		expect(res.status).toBe(2);
		expect(res.stderr).toContain('Step 1');
	});

	it('says a build timed out instead of blaming the path', () => {
		const file = scenario([['list']]);

		const res = spawnSync(
			process.execPath,
			[
				compareScript,
				'--a',
				'sleep 5 #',
				'--b',
				real,
				'--scenario',
				file,
				'--timeout',
				'1000'
			],
			{ encoding: 'utf8', timeout: 60000 }
		);

		expect(res.status).toBe(2);
		expect(res.stderr).toContain('timed out');
	});
});
