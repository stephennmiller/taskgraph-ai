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
	buildJudgePrompt
} from '@tm/core';
import { z } from 'zod';
import * as aiServices from '../../scripts/modules/ai-services-unified.js';
import * as configManager from '../../scripts/modules/config-manager.js';
import * as taskManager from '../../scripts/modules/task-manager.js';
import { enableSilentMode } from '../../scripts/modules/utils.js';
import { PRD_PATH, type WorkerOutput } from './shared.js';

interface Telemetry {
	inputTokens?: number;
	outputTokens?: number;
	cachedInputTokens?: number;
	modelUsed?: string;
}

interface Called {
	telemetryData?: Telemetry | null;
}

/**
 * The legacy functions the CLI commands call, with the arguments the CLI
 * passes. Their JSDoc types are narrower than those calls, so they are
 * typed here.
 */
const legacy = {
	...taskManager,
	...aiServices,
	...configManager
} as unknown as {
	parsePRD(
		prdPath: string,
		tasksPath: string,
		numTasks: number,
		options: object
	): Promise<Called>;
	analyzeTaskComplexity(
		options: object,
		context: object
	): Promise<Called & { report: { complexityAnalysis?: PlanComplexity[] } }>;
	expandTask(
		tasksPath: string,
		taskId: number | string,
		numSubtasks: number | undefined,
		useResearch: boolean,
		additionalContext: string,
		context: object,
		force: boolean
	): Promise<Called>;
	generateObjectService(
		params: object
	): Promise<Called & { mainResult: unknown }>;
	getDefaultNumTasks(projectRoot: string): number;
};

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
const output: WorkerOutput = {
	tasks: [],
	complexity: [],
	calls: [],
	verdict: null
};

/** Time one model call and record its usage */
async function timed<T extends Called>(
	command: EvalCall['command'],
	run: () => Promise<T>,
	taskId?: string
): Promise<T> {
	const start = performance.now();
	const result = await run();
	const usage = result?.telemetryData;
	output.calls.push({
		command,
		...(taskId ? { taskId } : {}),
		seconds: (performance.now() - start) / 1000,
		inputTokens: usage?.inputTokens ?? 0,
		outputTokens: usage?.outputTokens ?? 0,
		...(usage?.cachedInputTokens
			? { cachedInputTokens: usage.cachedInputTokens }
			: {}),
		...(usage ? { model: usage.modelUsed } : { usageMissing: true })
	});
	return result;
}

const readTasks = (): PlanTask[] =>
	JSON.parse(fs.readFileSync(tasksPath, 'utf8')).master?.tasks ?? [];

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
	enableSilentMode();
	const context = {
		projectRoot: projectDir,
		mcpLog: quiet,
		outputType: 'mcp'
	};
	const prdFile = path.join(projectDir, PRD_PATH);

	await timed('parse-prd', () =>
		legacy.parsePRD(prdFile, tasksPath, legacy.getDefaultNumTasks(projectDir), {
			...context,
			force: true,
			commandName: 'parse-prd'
		})
	);
	output.tasks = readTasks();

	const analysis = await timed('analyze-complexity', () =>
		legacy.analyzeTaskComplexity(
			{ file: tasksPath, output: reportPath, projectRoot: projectDir },
			{ ...context, commandName: 'analyze-complexity' }
		)
	);
	output.complexity = analysis.report.complexityAnalysis ?? [];

	for (const task of output.tasks) {
		await timed(
			'expand',
			() =>
				legacy.expandTask(
					tasksPath,
					task.id,
					undefined,
					false,
					'',
					{
						...context,
						complexityReportPath: reportPath,
						commandName: 'expand-task'
					},
					true
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
	const graded = await timed('judge', () =>
		legacy.generateObjectService({
			role: 'main',
			projectRoot: projectDir,
			schema: verdictSchema,
			objectName: 'plan_grades',
			systemPrompt,
			prompt,
			commandName: 'eval-judge',
			outputType: 'mcp'
		})
	);
	output.verdict = graded.mainResult as JudgeVerdict;
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
