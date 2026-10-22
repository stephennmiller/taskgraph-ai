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
	summarizeRun
} from '../parity/compare-builds.mjs';
import { normalizeSnapshot } from '../parity/normalize.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const compareScript = path.resolve(here, '../parity/compare-builds.mjs');
const fixture = path.resolve(here, '../parity/fixtures/tasks-tagged.json');
const cli = getCliBinPath();
const built = fs.existsSync(cli);

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
		expect(scenarioJson.steps.length).toBeGreaterThan(0);
		for (const step of scenarioJson.steps) {
			const ok =
				Array.isArray(step) ||
				typeof step.shell === 'string' ||
				Array.isArray(step.args);
			expect(ok, JSON.stringify(step)).toBe(true);
			if (step.capture !== undefined) expect(step.capture).toBe('stdout');
		}
	});
});

describe('buildEnv', () => {
	it('gives the build its own home so a global config cannot leak in', () => {
		const env = buildEnv('/tmp/work-x', { HOME: '/home/dev', PATH: '/bin' });

		expect(env.HOME).toBe('/tmp/work-x/home');
		expect(env.XDG_CONFIG_HOME).toBe('/tmp/work-x/home/.config');
		expect(env.PATH).toBe('/bin');
		expect(env.TASKGRAPH_SKIP_AUTO_UPDATE).toBe('1');
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

describe('summarizeRun', () => {
	const step = (status: number, files: Record<string, string>) => ({
		args: ['x'],
		status,
		files
	});

	it('counts steps, failed steps and steps that changed a file', () => {
		const summary = summarizeRun({
			steps: [
				step(0, { 'a.json': '1' }), // setup, not counted
				step(0, { 'a.json': '1' }), // no change
				step(0, { 'a.json': '2' }), // changed
				step(1, { 'a.json': '2', 'b.json': '1' }), // failed, new file
				step(0, { 'a.json': '2', 'b.json': '1' }) // no change
			]
		});

		expect(summary).toEqual({ steps: 4, failed: 1, changedFiles: 2 });
	});

	it('does not count captured output as a changed file', () => {
		const summary = summarizeRun({
			steps: [
				step(0, { 'a.json': '1' }),
				step(0, { 'a.json': '1', 'stdout:1': '{}' }),
				step(0, { 'a.json': '1' })
			]
		});

		expect(summary.changedFiles).toBe(0);
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
		expect(res.stdout).toMatch(/2 steps, 0 failed, 2 changed files/);
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
});
