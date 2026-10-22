#!/usr/bin/env node
/**
 * Run one scenario of CLI commands against two builds and compare what each
 * leaves on disk. Used as a gate while the legacy scripts move into @tm/core:
 * the same commands on the current build and on the last release should end
 * with the same files.
 *
 *   node apps/cli/tests/parity/compare-builds.mjs --a <build> --b <build> \
 *     [--scenario <file>] [--timeout <ms>]
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
 * A step is a list of CLI arguments, or an object:
 *   { "args": [...], "capture": "stdout" }  also compare what the command
 *       printed (use a JSON format, such as `next --format json`)
 *   { "shell": "..." }  run a shell command in the project to prepare state
 *       (not part of the build under test)
 *   { "mcp": "<tool>", "input": {...}, "expectError": false }  call an MCP
 *       tool on each build's server and compare the reply. "<project>" in
 *       the input becomes the temp project's path. The server is derived from
 *       the build (see deriveServerCommand).
 * Every step is expected to exit 0; add "expectExit": N to a step that is
 * meant to fail. A step that exits otherwise fails the run even when both
 * builds agree, so a typo in a scenario cannot pass as "no differences".
 *
 * Exit code: 0 no differences and every step exited as expected, 1 differences
 * or an unexpected exit, 2 bad usage, a bad scenario or a build that cannot run.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installFakeClaude } from '../fakes/install-fake-claude.mjs';
import { normalizeSnapshot } from './normalize.mjs';
import { callMcpTool, isMcpStep, serverFor } from './mcp-step.mjs';

export { deriveServerCommand } from './mcp-step.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const STEP_TIMEOUT_MS = 60000;
// The first call can download the package (npx on a cold cache)
const INIT_TIMEOUT_MS = 300000;

/** Unified diff of two texts, from the first hunk on. */
function unifiedDiff(a, b) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-'));
	try {
		fs.writeFileSync(path.join(dir, 'a'), a);
		fs.writeFileSync(path.join(dir, 'b'), b);
		const res = spawnSync(
			'git',
			[
				'diff',
				'--no-index',
				'--no-ext-diff',
				'--no-textconv',
				'--no-color',
				'-U3',
				'--',
				'a',
				'b'
			],
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
	const env = {
		...base,
		HOME: home,
		XDG_CONFIG_HOME: path.join(home, '.config'),
		npm_config_cache: base.npm_config_cache ?? path.join(realHome, '.npm'),
		npm_config_userconfig:
			base.npm_config_userconfig ?? path.join(realHome, '.npmrc'),
		TASKGRAPH_SKIP_AUTO_UPDATE: '1'
	};
	// The MCP server prefers this over a tool's projectRoot; a developer's own
	// value would send writes into a real project.
	delete env.TASKGRAPH_PROJECT_ROOT;
	return env;
}

const STDERR_TAIL = 400;
const ANSI = /\u001b\[[0-9;]*m/g;

const STEP_KEYS = [
	'args',
	'shell',
	'capture',
	'expectExit',
	'mcp',
	'input',
	'expectError'
];

/**
 * Check a scenario's shape so a typo fails at the start with the step number,
 * not as an odd error halfway through a run.
 * @throws {Error} Naming the first problem found
 */
export function validateScenario(scenario) {
	if (!scenario || typeof scenario !== 'object') {
		throw new Error('The scenario must be a JSON object');
	}
	if (!Array.isArray(scenario.steps) || scenario.steps.length === 0) {
		throw new Error('The scenario needs a non-empty "steps" list');
	}
	if (scenario.replies !== undefined && !Array.isArray(scenario.replies)) {
		throw new Error('"replies" must be a list');
	}
	if (scenario.fixture !== undefined && typeof scenario.fixture !== 'string') {
		throw new Error('"fixture" must be a path');
	}
	scenario.steps.forEach((step, index) => {
		const where = `Step ${index + 1}`;
		const strings = (list) =>
			Array.isArray(list) && list.every((item) => typeof item === 'string');
		if (Array.isArray(step)) {
			if (!strings(step))
				throw new Error(`${where}: arguments must be strings`);
			return;
		}
		if (!step || typeof step !== 'object') {
			throw new Error(`${where}: must be a list of arguments or an object`);
		}
		for (const key of Object.keys(step)) {
			if (!STEP_KEYS.includes(key)) {
				throw new Error(
					`${where}: unknown key "${key}" (allowed: ${STEP_KEYS.join(', ')})`
				);
			}
		}
		if (step.mcp !== undefined) {
			for (const key of ['args', 'shell', 'capture', 'expectExit']) {
				if (step[key] !== undefined) {
					throw new Error(
						`${where}: mcp cannot be combined with ${key}${key === 'expectExit' ? ' (use expectError)' : ''}`
					);
				}
			}
			if (typeof step.mcp !== 'string' || step.mcp === '') {
				throw new Error(`${where}: mcp must be a tool name`);
			}
			const input = step.input;
			if (
				input !== undefined &&
				(!input || typeof input !== 'object' || Array.isArray(input))
			) {
				throw new Error(`${where}: input must be an object`);
			}
			if (
				step.expectError !== undefined &&
				typeof step.expectError !== 'boolean'
			) {
				throw new Error(`${where}: expectError must be true or false`);
			}
			return;
		}
		if (step.input !== undefined || step.expectError !== undefined) {
			throw new Error(
				`${where}: input and expectError only apply to an mcp step`
			);
		}
		if ((step.args === undefined) === (step.shell === undefined)) {
			throw new Error(`${where}: needs either args or shell`);
		}
		if (step.args !== undefined && !strings(step.args)) {
			throw new Error(`${where}: arguments must be strings`);
		}
		if (step.shell !== undefined && typeof step.shell !== 'string') {
			throw new Error(`${where}: shell must be a string`);
		}
		if (step.capture !== undefined) {
			if (step.shell !== undefined) {
				throw new Error(`${where}: capture does not apply to a shell step`);
			}
			if (step.capture !== 'stdout') {
				throw new Error(`${where}: capture can only be "stdout"`);
			}
		}
		if (
			step.expectExit !== undefined &&
			!(Number.isInteger(step.expectExit) && step.expectExit >= 0)
		) {
			throw new Error(`${where}: expectExit must be a whole number`);
		}
	});
}

/** @returns {{args: string[], shell?: string, mcp?: {tool: string, input: object}, capture: boolean, expected: number}} */
function parseStep(spec) {
	if (Array.isArray(spec)) return { args: spec, capture: false, expected: 0 };
	if (isMcpStep(spec)) {
		const input = spec.input ?? {};
		return {
			args: ['mcp', spec.mcp, JSON.stringify(input)],
			mcp: { tool: spec.mcp, input },
			capture: false,
			expected: spec.expectError ? 1 : 0
		};
	}
	const expected = spec.expectExit ?? 0;
	if (typeof spec.shell === 'string') {
		return {
			args: ['shell', spec.shell],
			shell: spec.shell,
			capture: false,
			expected
		};
	}
	return { args: spec.args, capture: spec.capture === 'stdout', expected };
}

/**
 * Run a scenario against one build.
 * @param {string} build Shell command that runs the CLI
 * @param {{fixture?: string, replies?: object[], steps: string[][]}} scenario
 *   `fixture` must be an absolute path
 * @returns {{steps: Array<{args: string[], status: number|null, files: Record<string,string>}>}}
 *   Entry 0 is the setup (init and the fixture); the rest follow the scenario.
 */
export function runScenario(build, scenario, { timeoutMs } = {}) {
	const server = scenario.steps.some(isMcpStep) ? serverFor(build) : null;
	const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parity-proj-'));
	const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parity-work-'));
	try {
		const env = buildEnv(workDir);
		fs.mkdirSync(env.HOME, { recursive: true });
		const run = (
			args,
			extraEnv = {},
			shell = null,
			timeout = STEP_TIMEOUT_MS
		) => {
			const argv = shell
				? ['-c', shell]
				: ['-c', `${build} "$@"`, 'sh', ...args];
			const res = spawnSync('sh', argv, {
				cwd: projectDir,
				env: { ...env, ...extraEnv },
				encoding: 'utf8',
				timeout
			});
			const result = { status: res.status, stdout: res.stdout ?? '' };
			if (res.error) result.error = res.error.code ?? res.error.message;
			else if (res.signal) result.error = res.signal;
			const tail = (res.stderr ?? '').trim().slice(-STDERR_TAIL);
			if (tail) result.stderr = tail;
			return result;
		};

		const git = spawnSync('git', ['init', '-q'], { cwd: projectDir });
		if (git.error)
			throw new Error('git is needed to set up a project, and could not run');
		const initTimeout = timeoutMs ?? INIT_TIMEOUT_MS;
		const init = run(['init', '--yes'], {}, null, initTimeout);
		if (init.status !== 0) {
			const why =
				init.error === 'ETIMEDOUT'
					? `timed out after ${initTimeout / 1000}s (a first npx run downloads the package; use --timeout to allow longer)`
					: `exit ${init.status ?? init.error}. The command runs inside a temp project, so paths in it must be absolute`;
			throw new Error(
				`"${build}" could not run init: ${why}.` +
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

		// One server start per call; the first also records the tool schemas
		let toolsRecorded = false;

		const steps = [
			{
				args: ['init', '--yes', '+ fixture'],
				status: init.status,
				expected: 0,
				files: snapshot(projectDir, workDir)
			}
		];
		for (const spec of scenario.steps) {
			const { args, shell, mcp, capture, expected } = parseStep(spec);
			const timeout = timeoutMs ?? STEP_TIMEOUT_MS;
			const {
				stdout,
				files: mcpFiles,
				...result
			} = mcp
				? callMcpTool({
						server,
						...mcp,
						timeout,
						projectDir,
						workDir,
						env: { ...env, ...fake.env },
						index: steps.length,
						withTools: !toolsRecorded
					})
				: run(args, fake.env, shell, timeout);
			if (mcpFiles?.['mcp:tools']) toolsRecorded = true;
			const files = { ...snapshot(projectDir, workDir), ...mcpFiles };
			if (capture) {
				files[`stdout:${steps.length}`] = normalizeSnapshot(
					'stdout.json',
					stdout.replace(ANSI, ''),
					{ projectDir, workDir }
				);
			}
			steps.push({ args, expected, ...result, files });
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
 * Steps that did not exit as the scenario expects (0 unless it says otherwise).
 * Two builds failing the same way show no difference, so this is what stops
 * a broken scenario from passing.
 * @returns {Array<{step: number, args: string[], status: number|null, expected: number}>}
 */
export function unexpectedExits(run) {
	const found = [];
	run.steps.slice(1).forEach((step, i) => {
		const expected = step.expected ?? 0;
		if (step.status !== expected) {
			found.push({
				step: i + 1,
				args: step.args,
				status: step.status,
				expected,
				...(step.stderr ? { stderr: step.stderr } : {})
			});
		}
	});
	return found;
}

/**
 * How much a run did, so "no differences" can be told apart from "nothing
 * happened": steps run (not counting the setup), steps that exited non-zero,
 * and steps that changed state (a file under .taskgraph/).
 */
export function summarizeRun(run) {
	const stateOf = (step) =>
		JSON.stringify(
			Object.entries(step.files).filter(
				([name]) => !name.startsWith('stdout:') && !name.startsWith('mcp:')
			)
		);
	const steps = run.steps.slice(1);
	let changedState = 0;
	let failed = 0;
	steps.forEach((step, i) => {
		if (step.status !== (step.expected ?? 0)) failed++;
		if (stateOf(step) !== stateOf(run.steps[i])) changedState++;
	});
	return { steps: steps.length, failed, changedState };
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
		scenario: path.join(here, 'scenarios', 'basic.json'),
		timeoutMs: undefined
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
		else if (arg === '--timeout') {
			opts.timeoutMs = Number(value());
			if (!Number.isFinite(opts.timeoutMs) || opts.timeoutMs <= 0) {
				throw new Error('--timeout needs a number of milliseconds');
			}
		} else throw new Error(`Unknown option ${arg}`);
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
	try {
		validateScenario(scenario);
	} catch (err) {
		console.error(`Scenario ${opts.scenario}: ${err.message}`);
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
		if (scenario.steps.some(isMcpStep)) {
			serverFor(opts.a);
			serverFor(opts.b);
		}
		a = runScenario(opts.a, scenario, { timeoutMs: opts.timeoutMs });
		b = runScenario(opts.b, scenario, { timeoutMs: opts.timeoutMs });
	} catch (err) {
		console.error(err.message);
		process.exitCode = 2;
		return;
	}

	const differences = compareRuns(a, b);
	console.log(
		formatReport(differences, a.steps.length - 1, { a: opts.a, b: opts.b })
	);
	let unexpected = 0;
	for (const [label, run] of [
		['A', a],
		['B', b]
	]) {
		const { steps, failed, changedState } = summarizeRun(run);
		console.log(
			`Build ${label} ran ${steps} steps, ${failed} failed, ${changedState} changed state.`
		);
		for (const u of unexpectedExits(run)) {
			unexpected++;
			console.log(
				`Build ${label}: step ${u.step} (${u.args.join(' ')}) did not exit as expected: exit ${u.status}, expected ${u.expected}.`
			);
			if (u.stderr) console.log(`  stderr: ${u.stderr}`);
		}
	}
	process.exitCode = differences.length > 0 || unexpected > 0 ? 1 : 0;
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	main();
}
