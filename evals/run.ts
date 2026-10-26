/**
 * `npm run evals`: make a plan from each sample PRD with the real model,
 * score it, and compare it with the committed baseline.
 *
 *   npm run evals                        every sample, with the judge
 *   npm run evals -- --only cli-notes    some samples (comma-separated)
 *   npm run evals -- --no-judge          skip the LLM judge
 *   npm run evals -- --config my.json    models from a TaskGraph config.json
 *   npm run evals -- --update-baseline   save this run as evals/baseline.json
 *                                        (every sample, with the judge)
 *   npm run evals -- --keep              keep each sample's project
 *
 * Each sample runs in a fresh project in the system temp dir: `taskgraph
 * init`, the PRD in .taskgraph/docs/prd.md (and the sample's codebase/, if
 * it has one), then parse-prd, analyze-complexity, expand on each task and
 * the judge, through the same code and AI backend as the CLI. It calls the
 * model for real and is never run in CI. The run is saved to
 * evals/results/<date>T<time>.json.
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
	EVAL_RUN_SCHEMA_VERSION,
	type EvalRun,
	type EvalSampleResult,
	checkPlan,
	diffEvalRuns,
	measurePrd,
	sampleSeconds,
	scoreJudgeVerdict,
	summarizeEvalRun
} from '@tm/core';
import { biomeFormattedJson } from './lib/baseline.js';
import { formatDiff, formatRun } from './lib/format.js';
import { PRD_PATH, type WorkerOutput, fail } from './lib/shared.js';

interface Sample {
	id: string;
	kind: string;
	description: string;
}

const evalsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(evalsDir);
const samplesDir = path.join(evalsDir, 'samples');
const resultsDir = path.join(evalsDir, 'results');
const baselinePath = path.join(evalsDir, 'baseline.json');
const tsx = fileURLToPath(import.meta.resolve('tsx/cli'));

const { values: args } = parseArgs({
	options: {
		only: { type: 'string' },
		'no-judge': { type: 'boolean', default: false },
		config: { type: 'string' },
		'update-baseline': { type: 'boolean', default: false },
		keep: { type: 'boolean', default: false }
	}
});

const allSamples: Sample[] = JSON.parse(
	fs.readFileSync(path.join(evalsDir, 'samples.json'), 'utf8')
);
const only = args.only?.split(',').map((id) => id.trim());
const unknown = only?.filter((id) => !allSamples.some((s) => s.id === id));
if (unknown?.length) {
	fail(
		`No sample named ${unknown.join(', ')}`,
		`Samples: ${allSamples.map((s) => s.id).join(', ')}`
	);
}
if (only && args['update-baseline']) {
	fail(
		"--update-baseline needs every sample, so it can't be used with --only",
		'Run `npm run evals -- --update-baseline`'
	);
}
if (args['no-judge'] && args['update-baseline']) {
	fail(
		"--update-baseline needs the judge's scores, so it can't be used with --no-judge",
		'Run `npm run evals -- --update-baseline`'
	);
}
const configPath = args.config ? path.resolve(args.config) : undefined;
if (configPath && !fs.existsSync(configPath)) {
	fail(
		`${args.config} doesn't exist`,
		'Pass a TaskGraph .taskgraph/config.json'
	);
}
const samples = only
	? allSamples.filter((s) => only.includes(s.id))
	: allSamples;

const childEnv = {
	...process.env,
	TASKGRAPH_SKIP_AUTO_UPDATE: '1',
	...(args['no-judge'] ? { EVALS_NO_JUDGE: '1' } : {})
};

/** A fresh, initialized project holding the sample's PRD and codebase */
function prepareProject(sample: Sample): string {
	const dir = fs.mkdtempSync(
		path.join(os.tmpdir(), `taskgraph-eval-${sample.id}-`)
	);
	try {
		const codebase = path.join(samplesDir, sample.id, 'codebase');
		if (fs.existsSync(codebase)) fs.cpSync(codebase, dir, { recursive: true });
		spawnSync('git', ['init', '-q'], { cwd: dir });
		const init = spawnSync(
			process.execPath,
			[tsx, path.join(repoRoot, 'scripts', 'dev.js'), 'init', '--yes'],
			{ cwd: dir, env: childEnv, encoding: 'utf8' }
		);
		// init exits 0 even when a step fails, so check it made the config
		if (
			init.status !== 0 ||
			!fs.existsSync(path.join(dir, '.taskgraph', 'config.json'))
		) {
			throw new Error(`taskgraph init failed: ${init.stderr.trim()}`);
		}
		if (configPath) {
			fs.copyFileSync(configPath, path.join(dir, '.taskgraph', 'config.json'));
		}
		const prd = path.join(dir, PRD_PATH);
		fs.mkdirSync(path.dirname(prd), { recursive: true });
		fs.copyFileSync(path.join(samplesDir, sample.id, 'prd.md'), prd);
		return dir;
	} catch (error) {
		// evaluate() only cleans up a project it got back
		fs.rmSync(dir, { recursive: true, force: true });
		throw error;
	}
}

/** Run the worker for one project; resolves with what it wrote */
function runWorker(projectDir: string): Promise<WorkerOutput> {
	const outFile = path.join(
		projectDir,
		'..',
		`${path.basename(projectDir)}.json`
	);
	return new Promise((resolve, reject) => {
		const child = spawn(
			process.execPath,
			[tsx, path.join(evalsDir, 'lib', 'plan-worker.ts'), projectDir, outFile],
			{ cwd: projectDir, env: childEnv, stdio: ['ignore', 'ignore', 'inherit'] }
		);
		child.on('error', reject);
		child.on('close', (code) => {
			try {
				resolve(JSON.parse(fs.readFileSync(outFile, 'utf8')));
			} catch {
				reject(new Error(`the plan worker exited with ${code} and no result`));
			} finally {
				fs.rmSync(outFile, { force: true });
			}
		});
	});
}

async function evaluate(sample: Sample): Promise<EvalSampleResult> {
	const prdContent = fs.readFileSync(
		path.join(samplesDir, sample.id, 'prd.md'),
		'utf8'
	);
	const size = measurePrd(prdContent);
	const base = {
		id: sample.id,
		kind: sample.kind,
		words: size.words,
		sections: size.sections
	};
	let projectDir: string | undefined;
	try {
		projectDir = prepareProject(sample);
		const output = await runWorker(projectDir);
		const planned = output.tasks.length > 0;
		const { checks, score } = planned
			? checkPlan({
					tasks: output.tasks,
					prdPath: PRD_PATH,
					prdContent,
					complexity: output.complexity
				})
			: { checks: null, score: null };
		return {
			...base,
			taskCount: output.tasks.length,
			subtaskCount: output.tasks.reduce(
				(sum, t) => sum + (t.subtasks?.length ?? 0),
				0
			),
			// A plan cut short by an error keeps its checks for reading, but
			// its score would move the run's averages, so it has none
			checkScore: output.error ? null : score,
			checks,
			judge: output.verdict ? scoreJudgeVerdict(output.verdict) : null,
			calls: output.calls,
			...(output.error ? { error: output.error } : {})
		};
	} catch (error) {
		return {
			...base,
			taskCount: 0,
			subtaskCount: 0,
			checkScore: null,
			checks: null,
			judge: null,
			calls: [],
			error: error instanceof Error ? error.message : String(error)
		};
	} finally {
		if (projectDir && !args.keep) {
			fs.rmSync(projectDir, { recursive: true, force: true });
		} else if (projectDir) {
			console.error(`  ${sample.id} project kept in ${projectDir}`);
		}
	}
}

const started = new Date();
const results: EvalSampleResult[] = [];
console.error(
	`Running ${samples.length === 1 ? '1 sample' : `${samples.length} samples`}; each takes a few minutes of model calls`
);
for (const [index, sample] of samples.entries()) {
	console.error(`${sample.id} (${index + 1} of ${samples.length})`);
	const result = await evaluate(sample);
	const secs = Math.round(sampleSeconds(result));
	console.error(
		result.error
			? `✗ ${sample.id}: ${result.error}`
			: `✓ ${sample.id} · ${result.taskCount} tasks · ${secs}s`
	);
	results.push(result);
}

const commit = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
	cwd: repoRoot,
	encoding: 'utf8'
}).stdout.trim();
const run: EvalRun = {
	schemaVersion: EVAL_RUN_SCHEMA_VERSION,
	date: started.toISOString(),
	...(commit ? { commit } : {}),
	samples: results,
	summary: summarizeEvalRun(results)
};

fs.mkdirSync(resultsDir, { recursive: true });
// Date and time, so a before and an after run on one day both stay
const resultFile = path.join(
	resultsDir,
	`${run.date.slice(0, 19).replaceAll(':', '-')}.json`
);
fs.writeFileSync(resultFile, `${JSON.stringify(run, null, '\t')}\n`);

console.log(`\n${formatRun(run)}\n`);
const baseline: EvalRun | null = fs.existsSync(baselinePath)
	? JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
	: null;
if (baseline && baseline.schemaVersion !== EVAL_RUN_SCHEMA_VERSION) {
	console.log(
		`The baseline has schemaVersion ${baseline.schemaVersion}, this run ${EVAL_RUN_SCHEMA_VERSION}, so they can't be compared; save a new one with npm run evals -- --update-baseline\n`
	);
} else if (baseline) {
	console.log(`${formatDiff(diffEvalRuns(run, baseline), baseline)}\n`);
} else if (!args['update-baseline']) {
	console.log(
		'No baseline yet; save one with npm run evals -- --update-baseline\n'
	);
}
console.log(`Saved to ${path.relative(repoRoot, resultFile)}`);

if (args['update-baseline']) {
	if (run.summary.failed > 0) {
		fail(
			`Baseline not updated: ${run.summary.failed} samples failed`,
			'Fix the failures and run again'
		);
	}
	fs.writeFileSync(
		baselinePath,
		biomeFormattedJson(run, repoRoot, baselinePath)
	);
	console.log(
		`Saved as the baseline in ${path.relative(repoRoot, baselinePath)}`
	);
}
if (run.summary.failed > 0) process.exitCode = 1;
