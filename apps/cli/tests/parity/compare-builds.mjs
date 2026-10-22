#!/usr/bin/env node
/**
 * Run one scenario of CLI commands against two builds and compare what each
 * leaves on disk. Used as a gate while the legacy scripts move into @tm/core:
 * the same commands on the current build and on the last release should end
 * with the same files.
 *
 *   node apps/cli/tests/parity/compare-builds.mjs --a <build> --b <build> \
 *     [--scenario <file>]
 *
 * A <build> is a shell command that runs the CLI, such as
 * `node dist/taskgraph.js` or `npx -y -p taskgraph-ai@0.54.7 taskgraph`.
 * The command is given the scenario's arguments, one step at a time. It runs
 * inside the temp project, so a path in it must be absolute.
 *
 * Each build gets its own fresh project: `init`, the scenario's fixture as
 * tasks.json, and the fake claude program (see ../fakes) for AI commands. After
 * the setup and after every step it records the exit code and the normalized
 * files in .taskgraph/ (config, state, tasks, reports; see normalize.mjs).
 *
 * Scenario file (JSON, paths relative to the file):
 *   { "fixture": "tasks.json to start from", "replies": [canned fake replies],
 *     "steps": [["set-status", "--id=1", "--status=done"], ...] }
 *
 * Exit code: 0 no differences, 1 differences, 2 bad usage or a build that
 * cannot run.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installFakeClaude } from '../fakes/install-fake-claude.mjs';
import { normalizeSnapshot } from './normalize.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const STEP_TIMEOUT_MS = 60000;

/** Unified diff of two texts, from the first hunk on. */
function unifiedDiff(a, b) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-'));
	try {
		fs.writeFileSync(path.join(dir, 'a'), a);
		fs.writeFileSync(path.join(dir, 'b'), b);
		const res = spawnSync(
			'git',
			['diff', '--no-index', '--no-color', '-U3', '--', 'a', 'b'],
			{ cwd: dir, encoding: 'utf8' }
		);
		if (res.error || typeof res.stdout !== 'string') {
			throw new Error('git is needed to show differences, and could not run');
		}
		const out = res.stdout;
		const start = out.indexOf('@@');
		return start >= 0 ? out.slice(start) : out;
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

/**
 * @param {Record<string, string>} a Normalized files of build A, by path
 * @param {Record<string, string>} b Normalized files of build B, by path
 * @returns {Array<{file: string, kind: 'changed'|'only-in-a'|'only-in-b', diff: string}>}
 */
export function diffSnapshots(a, b) {
	const files = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
	const diffs = [];
	for (const file of files) {
		if (!(file in b)) diffs.push({ file, kind: 'only-in-a', diff: '' });
		else if (!(file in a)) diffs.push({ file, kind: 'only-in-b', diff: '' });
		else if (a[file] !== b[file]) {
			diffs.push({
				file,
				kind: 'changed',
				diff: unifiedDiff(a[file], b[file])
			});
		}
	}
	return diffs;
}

/** Files that describe a project's state; locks and temp files are skipped. */
function listStateFiles(root) {
	const found = [];
	const walk = (dir) => {
		if (!fs.existsSync(dir)) return;
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (/\.(lock|tmp)$|\.stale\./.test(entry.name)) continue;
			if (entry.isDirectory()) walk(full);
			else found.push(full);
		}
	};
	for (const rel of ['config.json', 'state.json']) {
		const file = path.join(root, '.taskgraph', rel);
		if (fs.existsSync(file)) found.push(file);
	}
	walk(path.join(root, '.taskgraph', 'tasks'));
	walk(path.join(root, '.taskgraph', 'reports'));
	return found;
}

function snapshot(projectDir, workDir) {
	const files = {};
	for (const file of listStateFiles(projectDir)) {
		const rel = path.relative(projectDir, file);
		files[rel] = normalizeSnapshot(rel, fs.readFileSync(file, 'utf8'), {
			projectDir,
			workDir
		});
	}
	return files;
}

/**
 * Environment for the build under test: its own HOME and XDG dirs, so a global
 * TaskGraph config on this machine cannot change the result. The real npm
 * cache and user config stay, or every npx step would download again.
 * @param {string} workDir Directory outside the project
 * @param {Record<string, string|undefined>} [base]
 */
export function buildEnv(workDir, base = process.env) {
	const home = path.join(workDir, 'home');
	const realHome = base.HOME ?? os.homedir();
	return {
		...base,
		HOME: home,
		XDG_CONFIG_HOME: path.join(home, '.config'),
		npm_config_cache: base.npm_config_cache ?? path.join(realHome, '.npm'),
		npm_config_userconfig:
			base.npm_config_userconfig ?? path.join(realHome, '.npmrc'),
		TASKGRAPH_SKIP_AUTO_UPDATE: '1'
	};
}

const STDERR_TAIL = 400;

/**
 * Run a scenario against one build.
 * @param {string} build Shell command that runs the CLI
 * @param {{fixture?: string, replies?: object[], steps: string[][]}} scenario
 *   `fixture` must be an absolute path
 * @returns {{steps: Array<{args: string[], status: number|null, files: Record<string,string>}>}}
 *   Entry 0 is the setup (init and the fixture); the rest follow the scenario.
 */
export function runScenario(build, scenario) {
	const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parity-proj-'));
	const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parity-work-'));
	try {
		const env = buildEnv(workDir);
		fs.mkdirSync(env.HOME, { recursive: true });
		const run = (args, extraEnv = {}) => {
			const res = spawnSync('sh', ['-c', `${build} "$@"`, 'sh', ...args], {
				cwd: projectDir,
				env: { ...env, ...extraEnv },
				encoding: 'utf8',
				timeout: STEP_TIMEOUT_MS
			});
			const result = { status: res.status };
			if (res.error) result.error = res.error.code ?? res.error.message;
			else if (res.signal) result.error = res.signal;
			const tail = (res.stderr ?? '').trim().slice(-STDERR_TAIL);
			if (tail) result.stderr = tail;
			return result;
		};

		const git = spawnSync('git', ['init', '-q'], { cwd: projectDir });
		if (git.error)
			throw new Error('git is needed to set up a project, and could not run');
		const init = run(['init', '--yes']);
		if (init.status !== 0) {
			throw new Error(
				`"${build}" could not run init (exit ${init.status ?? init.error}). ` +
					`The command runs inside a temp project, so paths in it must be absolute.` +
					(init.stderr ? `\n${init.stderr}` : '')
			);
		}
		const fake = installFakeClaude({
			projectDir,
			workDir,
			replies: scenario.replies
		});
		if (scenario.fixture) {
			fs.copyFileSync(
				scenario.fixture,
				path.join(projectDir, '.taskgraph', 'tasks', 'tasks.json')
			);
		}

		const steps = [
			{
				args: ['init', '--yes', '+ fixture'],
				status: init.status,
				files: snapshot(projectDir, workDir)
			}
		];
		for (const args of scenario.steps) {
			const result = run(args, fake.env);
			steps.push({ args, ...result, files: snapshot(projectDir, workDir) });
		}
		return { steps };
	} finally {
		fs.rmSync(projectDir, { recursive: true, force: true });
		fs.rmSync(workDir, { recursive: true, force: true });
	}
}

const exited = (step) =>
	step.status === null
		? `ended without an exit code (${step.error ?? 'unknown'})`
		: `exited ${step.status}`;

function exitDetail(a, b) {
	const lines = [`A ${exited(a)}, B ${exited(b)}`];
	if (a.stderr) lines.push(`A stderr: ${a.stderr}`);
	if (b.stderr) lines.push(`B stderr: ${b.stderr}`);
	return lines.join('\n');
}

/**
 * @returns {Array<{step: number, args: string[], kind: string, detail: string}>}
 *   A file difference that is the same as the one reported at an earlier step
 *   is not repeated, so one divergence is not reported again at every step.
 */
export function compareRuns(a, b) {
	const differences = [];
	const lastDiff = new Map();
	a.steps.forEach((stepA, i) => {
		const stepB = b.steps[i];
		if (stepA.status !== stepB.status || stepA.error !== stepB.error) {
			differences.push({
				step: i,
				args: stepA.args,
				kind: 'exit code',
				detail: exitDetail(stepA, stepB)
			});
		}
		const now = new Map();
		for (const d of diffSnapshots(stepA.files, stepB.files)) {
			const detail = d.kind === 'changed' ? d.diff : d.kind;
			now.set(d.file, detail);
			if (lastDiff.get(d.file) === detail) continue;
			differences.push({ step: i, args: stepA.args, kind: d.file, detail });
		}
		lastDiff.clear();
		for (const [file, detail] of now) lastDiff.set(file, detail);
	});
	return differences;
}

/**
 * How much a run did, so "no differences" can be told apart from "nothing
 * happened": steps run (not counting the setup), steps that exited non-zero,
 * and steps that changed a file.
 */
export function summarizeRun(run) {
	const steps = run.steps.slice(1);
	let changedFiles = 0;
	let failed = 0;
	steps.forEach((step, i) => {
		if (step.status !== 0) failed++;
		if (JSON.stringify(step.files) !== JSON.stringify(run.steps[i].files)) {
			changedFiles++;
		}
	});
	return { steps: steps.length, failed, changedFiles };
}

export function formatReport(differences, stepCount, labels) {
	if (differences.length === 0) {
		return `No differences in ${stepCount} steps between ${labels.a} and ${labels.b}.`;
	}
	const lines = [`${labels.a}  vs  ${labels.b}`, ''];
	for (const d of differences) {
		lines.push(`Step ${d.step}: ${d.args.join(' ')}`);
		lines.push(`  ${d.kind}`);
		lines.push(
			...d.detail
				.trimEnd()
				.split('\n')
				.map((line) => `    ${line}`)
		);
		lines.push('');
	}
	lines.push(`${differences.length} difference(s) in ${stepCount} steps.`);
	return lines.join('\n');
}

function parseArgs(argv) {
	const opts = {
		a: null,
		b: null,
		scenario: path.join(here, 'scenarios', 'basic.json')
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		const value = () => {
			if (i + 1 >= argv.length) throw new Error(`${arg} needs a value`);
			return argv[++i];
		};
		if (arg === '--a') opts.a = value();
		else if (arg === '--b') opts.b = value();
		else if (arg === '--scenario') opts.scenario = path.resolve(value());
		else throw new Error(`Unknown option ${arg}`);
	}
	if (!opts.a || !opts.b) throw new Error('Both --a and --b are required');
	return opts;
}

function main() {
	let opts;
	try {
		opts = parseArgs(process.argv.slice(2));
	} catch (err) {
		console.error(err.message);
		process.exitCode = 2;
		return;
	}

	let scenario;
	try {
		scenario = JSON.parse(fs.readFileSync(opts.scenario, 'utf8'));
	} catch (err) {
		console.error(`Cannot read scenario ${opts.scenario}: ${err.message}`);
		process.exitCode = 2;
		return;
	}
	if (scenario.fixture) {
		scenario.fixture = path.resolve(
			path.dirname(opts.scenario),
			scenario.fixture
		);
	}

	let a;
	let b;
	try {
		a = runScenario(opts.a, scenario);
		b = runScenario(opts.b, scenario);
	} catch (err) {
		console.error(err.message);
		process.exitCode = 2;
		return;
	}

	const differences = compareRuns(a, b);
	console.log(
		formatReport(differences, a.steps.length - 1, { a: opts.a, b: opts.b })
	);
	for (const [label, run] of [
		['A', a],
		['B', b]
	]) {
		const { steps, failed, changedFiles } = summarizeRun(run);
		console.log(
			`Build ${label} ran ${steps} steps, ${failed} failed, ${changedFiles} changed files.`
		);
	}
	process.exitCode = differences.length > 0 ? 1 : 0;
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	main();
}
