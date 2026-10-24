/**
 * Makes one sample's plan in a prepared project, the way the CLI does:
 * parse-prd, analyze-complexity, expand on every task, then asks the judge
 * to grade the result. Every call goes through the same code and AI backend
 * as the CLI commands (Claude Code unless the project's config says
 * otherwise), so it calls the real model.
 *
 * Run by evals/run.ts in its own process, so each project gets a fresh
 * config cache: `tsx evals/lib/plan-worker.ts <projectDir> <outFile>`.
 * Writes a WorkerOutput as JSON to <outFile>, also when a step fails.
 */

import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
	type EvalCall,
	type JudgeVerdict,
	PLAN_JUDGE_RUBRIC,
	type PlanComplexity,
	type PlanTask,
	buildJudgePrompt,
	createTmCore
} from '@tm/core';
import { z } from 'zod';
import { PRD_PATH, type WorkerOutput } from './shared.js';

interface Telemetry {
	inputTokens?: number;
	outputTokens?: number;
	cachedInputTokens?: number;
	modelUsed?: string;
}

interface Called {
	telemetryData?: Telemetry | null;
	/** expand made no call: the complexity report recommends no subtasks */
	skipped?: unknown;
}

const [projectDir, outFile] = process.argv.slice(2);
if (!projectDir || !outFile) {
	console.error('Usage: tsx evals/lib/plan-worker.ts <projectDir> <outFile>');
	process.exit(2);
}

const tasksPath = path.join(projectDir, '.taskgraph', 'tasks', 'tasks.json');
const reportPath = path.join(
	projectDir,
	'.taskgraph',
	'reports',
	'task-complexity-report.json'
);
const quiet = {
	info() {},
	warn() {},
	debug() {},
	success() {},
	error(message: string) {
		process.stderr.write(`${message}\n`);
	}
};
/** One progress line per model step, so a long run doesn't look stuck */
const step = (text: string) => process.stderr.write(`  ${text}\n`);
const output: WorkerOutput = {
	tasks: [],
	complexity: [],
	calls: [],
	verdict: null
};

/** Time one model call and record its usage; a skipped expand isn't a call */
async function timed<T extends Called>(
	command: EvalCall['command'],
	run: () => Promise<T>,
	taskId?: string
): Promise<T> {
	const start = performance.now();
	const result = await run();
	if (result?.skipped) return result;
	const usage = result?.telemetryData;
	const reported = typeof usage?.inputTokens === 'number';
	output.calls.push({
		command,
		...(taskId ? { taskId } : {}),
		seconds: (performance.now() - start) / 1000,
		inputTokens: usage?.inputTokens ?? 0,
		outputTokens: usage?.outputTokens ?? 0,
		...(usage?.cachedInputTokens
			? { cachedInputTokens: usage.cachedInputTokens }
			: {}),
		...(usage?.modelUsed ? { model: usage.modelUsed } : {}),
		...(reported ? {} : { usageMissing: true })
	});
	return result;
}

/** The tag every step reads and writes, so a config can't move the plan */
const TAG = 'master';

const readTasks = (): PlanTask[] =>
	JSON.parse(fs.readFileSync(tasksPath, 'utf8'))[TAG]?.tasks ?? [];

const verdictSchema = z.object({
	grades: z.array(
		z.object({
			id: z.enum(PLAN_JUDGE_RUBRIC.map((c) => c.id) as [string, ...string[]]),
			grade: z.number().int().min(1).max(5),
			reason: z.string()
		})
	),
	summary: z.string()
});

async function main(judge: boolean): Promise<void> {
	const prdFile = path.join(projectDir, PRD_PATH);

	// A config or report warning changes the plan; say so
	const hooks = {
		onWarning: (message: string) => quiet.error(`warning: ${message}`)
	};
	const tmCore = await createTmCore({ projectPath: projectDir });
	try {
		step('parsing the PRD');
		await timed('parse-prd', () =>
			tmCore.tasks.parsePrd(
				{ prdPath: prdFile, force: true, tag: TAG, outputType: 'mcp' },
				hooks
			)
		);
		output.tasks = readTasks();
		if (output.tasks.length === 0) throw new Error('parse-prd made no tasks');

		step('scoring complexity');
		// Its `skipped` counts done tasks; timed() would read it as a skipped call
		const { report } = await timed('analyze-complexity', async () => {
			const { telemetryData, report } = await tmCore.tasks.analyzeComplexity(
				{ output: reportPath, tag: TAG, outputType: 'mcp' },
				// A task the AI left out gets a default score
				hooks
			);
			return { telemetryData, report };
		});
		output.complexity = report.complexityAnalysis as PlanComplexity[];

		for (const [index, task] of output.tasks.entries()) {
			step(`expanding task ${index + 1} of ${output.tasks.length}`);
			await timed(
				'expand',
				() =>
					tmCore.tasks.expand(
						{
							id: task.id,
							force: true,
							tag: TAG,
							complexityReportPath: reportPath,
							outputType: 'mcp'
						},
						hooks
					),
				String(task.id)
			);
		}
		output.tasks = readTasks();

		if (!judge) return;
		const { systemPrompt, prompt } = buildJudgePrompt(
			fs.readFileSync(prdFile, 'utf8'),
			output.tasks
		);
		step('judging the plan');
		const graded = await timed('judge', () =>
			tmCore.tasks.generateObject(
				{
					role: 'main',
					projectRoot: projectDir,
					schema: verdictSchema,
					objectName: 'plan_grades',
					systemPrompt,
					prompt,
					commandName: 'eval-judge',
					outputType: 'mcp'
				},
				hooks
			)
		);
		output.verdict = graded.mainResult as JudgeVerdict;
	} finally {
		await tmCore.close();
	}
}

main(process.env.EVALS_NO_JUDGE !== '1')
	.catch((error: unknown) => {
		output.error = error instanceof Error ? error.message : String(error);
		const failed = fs.existsSync(tasksPath) ? readTasks() : [];
		if (failed.length > 0) output.tasks = failed;
	})
	.finally(() => {
		fs.writeFileSync(outFile, JSON.stringify(output));
		// Providers can keep handles open; the result is written
		process.exit(0);
	});
