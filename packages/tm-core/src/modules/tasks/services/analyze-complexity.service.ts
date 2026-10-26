/**
 * @fileoverview Score each active task's complexity with the AI and save the
 * results to the tag's complexity report, keeping earlier entries for tasks
 * this run didn't analyze. The analyze-complexity prompt is eval-gated: its
 * inputs are built exactly as the legacy
 * scripts/modules/task-manager/analyze-task-complexity.js built them, from
 * tasks.json as stored (numeric IDs, no complexity fields merged in).
 */

import fs from 'node:fs';
import path from 'node:path';
import { TASKGRAPH_TASKS_FILE } from '../../../common/constants/paths.js';
import {
	ERROR_CODES,
	TaskGraphError
} from '../../../common/errors/taskgraph-error.js';
import type { Task } from '../../../common/types/index.js';
import {
	AiService,
	type AiTagInfo,
	type AiTelemetryData
} from '../../ai/ai-service.js';
import { AiConfig } from '../../ai/config-ai-host.js';
import { getPromptManager } from '../../ai/prompts/prompt-manager.js';
import { COMMAND_SCHEMAS } from '../../ai/schemas/registry.js';
import {
	findRelatedTaskIds,
	formatTasksContext
} from '../../ai/task-context.js';
import type { ConfigManager } from '../../config/managers/config-manager.js';
import {
	complexityReportPath,
	withoutPlaceholders
} from '../../reports/managers/complexity-report-manager.js';
import type { ComplexityReportMetadata } from '../../reports/types.js';
import { FileOperations } from '../../storage/adapters/file-storage/file-operations.js';
import { normalizeTaskStatus } from '../utils/legacy-status.js';

/** How many related tasks go into the prompt's project context */
const MAX_RELATED_TASKS = 10;

const ACTIVE_STATUSES = ['pending', 'blocked', 'in-progress'];

/** One task's entry in the report, as the AI writes it */
export interface ComplexityAnalysisItem {
	taskId: number | string;
	taskTitle: string;
	complexityScore: number;
	recommendedSubtasks: number;
	expansionPrompt: string;
	reasoning: string;
	/** Filled in because the AI left the task out: a default, not a score */
	placeholder?: true;
}

export interface ComplexityReportFile {
	meta: ComplexityReportMetadata;
	complexityAnalysis: ComplexityAnalysisItem[];
}

export interface AnalyzeComplexityInput {
	/** Comma-separated task IDs ("1,3,5"); wins over from/to */
	ids?: string;
	/** First task ID of a range; 1 when only `to` is given */
	from?: number | string;
	/** Last task ID of a range; the highest ID when only `from` is given */
	to?: number | string;
	/** Score from which expansion is recommended, 1-10; 5 when left out */
	threshold?: number | string;
	/** Use the research role */
	research?: boolean;
	/** Report file, relative to the project root; the tag's report when left out */
	output?: string;
	/** The active tag when left out */
	tag?: string;
	/**
	 * Analyze the tasks named by `ids` whatever their status (scope-up/down
	 * re-scores the task it just changed, even one in review or done)
	 */
	anyStatus?: boolean;
	/** The MCP session, for its env */
	session?: unknown;
	/** 'cli' or 'mcp', for usage telemetry */
	outputType?: string;
}

export interface AnalyzeComplexityHooks {
	/** A heads-up such as an ID with no active task */
	onWarning?: (message: string) => void;
	/** AI service detail and the saved report, sent only with `global.debug` on */
	onDebug?: (message: string) => void;
	/** The AI call is about to start */
	onAiCall?: (context: { taskCount: number }) => void;
}

export interface AnalyzeComplexityResult {
	/** The report as saved */
	report: ComplexityReportFile;
	reportPath: string;
	tag: string;
	/**
	 * This run's entries. A `placeholder` one is saved only when the report
	 * had no real entry for the task.
	 */
	analyses: ComplexityAnalysisItem[];
	/** Done, cancelled or deferred tasks among those asked for */
	skipped: number;
	/** Earlier entries kept in the report */
	kept: number;
	/** No task matched the IDs or range, so the existing report was left as it was */
	unchanged: boolean;
	telemetryData: AiTelemetryData | null;
	/** Set when the AI was called */
	tagInfo?: AiTagInfo;
}

/**
 * The tag's tasks as the legacy readJSON returned them: task and subtask IDs
 * as numbers, 'completed' read as 'done', nothing else changed. The prompt
 * shows these objects as JSON, so their shape is part of the prompt.
 */
function readStoredTasks(tasksPath: string, tag: string): Task[] {
	let data: any;
	try {
		data = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
		throw new TaskGraphError(
			`Couldn't read ${tasksPath}: ${(error as Error).message}`,
			ERROR_CODES.PARSE_ERROR
		);
	}
	// The flat format, from before tags, holds only master
	const tagData =
		data && Array.isArray(data.tasks)
			? tag === 'master'
				? data
				: undefined
			: data && Object.hasOwn(data, tag)
				? data[tag]
				: undefined;
	if (!tagData) {
		throw new TaskGraphError(`Tag "${tag}" not found.`, ERROR_CODES.NOT_FOUND);
	}
	const tasks: any[] = Array.isArray(tagData.tasks) ? tagData.tasks : [];
	const numericId = (id: unknown) => {
		const parsed = parseInt(String(id), 10);
		return !Number.isNaN(parsed) && parsed > 0 ? parsed : id;
	};
	return tasks.map((task) => ({
		...task,
		...(task.status !== undefined && {
			status: normalizeTaskStatus(task.status)
		}),
		...(task.id !== undefined && { id: numericId(task.id) }),
		...(Array.isArray(task.subtasks) && {
			subtasks: task.subtasks.map((subtask: any) => ({
				...subtask,
				...(subtask.status !== undefined && {
					status: normalizeTaskStatus(subtask.status)
				}),
				...(subtask.id !== undefined && {
					id: numericId(String(subtask.id).split('.').pop())
				})
			}))
		})
	}));
}

/** The threshold as a score from 1 to 10, checked before any AI call */
function parseThreshold(value: number | string | undefined): number {
	if (value === undefined || value === null || value === '') return 5;
	const threshold = parseFloat(String(value));
	if (Number.isNaN(threshold) || threshold < 1 || threshold > 10) {
		throw Object.assign(
			new TaskGraphError(
				`"${value}" isn't a threshold from 1 to 10`,
				ERROR_CODES.INVALID_INPUT
			),
			{ hint: 'Example: --threshold=6' }
		);
	}
	return threshold;
}

/** A task ID as parseInt reads it, or undefined when left out */
function parseRangeId(value: number | string | undefined, name: string) {
	if (value === undefined || value === null || value === '') return undefined;
	const id = parseInt(String(value), 10);
	if (Number.isNaN(id)) {
		throw Object.assign(
			new TaskGraphError(
				`"${value}" isn't a task ID for ${name}`,
				ERROR_CODES.INVALID_INPUT
			),
			{ hint: 'Example: --from=3 --to=7' }
		);
	}
	return id;
}

/** The IDs of `--id` ("1,3,5") as numbers; refuses one that isn't an ID */
function parseIds(value: string | undefined): number[] | null {
	if (!value) return null;
	const tokens = value
		.split(',')
		.map((id) => id.trim())
		.filter(Boolean);
	const bad = tokens.filter((id) => Number.isNaN(parseInt(id, 10)));
	if (bad.length > 0 || tokens.length === 0) {
		throw Object.assign(
			new TaskGraphError(
				`"${bad.join(',') || value}" isn't a task ID`,
				ERROR_CODES.INVALID_INPUT
			),
			{ hint: 'Example: --id=1,3,5' }
		);
	}
	return tokens.map((id) => parseInt(id, 10));
}

/** Report file names older versions wrote, newest first */
const REPORT_NAMES = [
	'task-complexity-report',
	'task-complexity',
	'complexity-report'
];

/**
 * A complexity report: `file` (relative to the project root) when given,
 * else the tag's report under .taskgraph/reports, under any name older
 * versions used, without placeholder entries. Null when there is none;
 * throws when it isn't valid JSON.
 */
export function readComplexityReport(
	projectRoot: string,
	{ tag, file }: { tag?: string; file?: string }
): { report: ComplexityReportFile; reportPath: string } | null {
	const candidates = file
		? [path.resolve(projectRoot, file)]
		: REPORT_NAMES.map((name) => {
				// Only the file name: the project path may hold the same words
				const tagReport = complexityReportPath(projectRoot, tag);
				return path.join(
					path.dirname(tagReport),
					path.basename(tagReport).replace('task-complexity-report', name)
				);
			});
	const reportPath = candidates.find((candidate) => fs.existsSync(candidate));
	if (!reportPath) return null;
	let report: ComplexityReportFile;
	try {
		report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
	} catch (error) {
		throw new TaskGraphError(
			`Couldn't read the complexity report: ${(error as Error).message}`,
			ERROR_CODES.PARSE_ERROR
		);
	}
	if (Array.isArray(report?.complexityAnalysis)) {
		report.complexityAnalysis = withoutPlaceholders(report.complexityAnalysis);
	}
	return { report, reportPath };
}

/** How many of the AI's scores are high (8+), medium (5-7) and low; placeholders aren't scores */
export function countComplexity(entries: readonly ComplexityAnalysisItem[]) {
	const scores = withoutPlaceholders(entries).map((e) => e.complexityScore);
	return {
		taskCount: scores.length,
		highComplexityTasks: scores.filter((s) => s >= 8).length,
		mediumComplexityTasks: scores.filter((s) => s >= 5 && s < 8).length,
		lowComplexityTasks: scores.filter((s) => s < 5).length
	};
}

export class AnalyzeComplexityService {
	constructor(private readonly configManager: ConfigManager) {}

	async analyze(
		input: AnalyzeComplexityInput,
		hooks: AnalyzeComplexityHooks = {}
	): Promise<AnalyzeComplexityResult> {
		const warn = (message: string) => hooks.onWarning?.(message);
		const debug = (message: string) => hooks.onDebug?.(message);
		const projectRoot = this.configManager.getProjectRoot();
		const tag = input.tag || this.configManager.getActiveTag();
		const useResearch = input.research === true;
		const threshold = parseThreshold(input.threshold);
		const specificIds = parseIds(input.ids);
		const fromId = parseRangeId(input.from, '--from');
		const toId = parseRangeId(input.to, '--to');
		const filtered =
			Boolean(specificIds) || fromId !== undefined || toId !== undefined;
		const reportPath = input.output
			? path.resolve(projectRoot, input.output)
			: complexityReportPath(projectRoot, tag);

		const allTasks = readStoredTasks(
			path.join(projectRoot, TASKGRAPH_TASKS_FILE),
			tag
		);
		if (allTasks.length === 0) {
			throw new TaskGraphError(
				'No tasks found in the tasks file',
				ERROR_CODES.NOT_FOUND
			);
		}

		const isActive = (task: Task) =>
			ACTIVE_STATUSES.includes(task.status?.toLowerCase() || 'pending');
		// IDs are numbers here (readStoredTasks), compared as the legacy command did
		const idOf = (task: Task) => task.id as unknown as number;
		const first = fromId ?? 1;
		const last = toId ?? Math.max(...allTasks.map(idOf));
		let inScope = (_task: Task) => true;
		if (specificIds && specificIds.length > 0) {
			inScope = (task) => specificIds.includes(idOf(task));
		} else if (fromId !== undefined || toId !== undefined) {
			inScope = (task) => idOf(task) >= first && idOf(task) <= last;
		}
		const counts = (task: Task) =>
			isActive(task) || (input.anyStatus === true && Boolean(specificIds));
		const tasks = allTasks.filter((task) => counts(task) && inScope(task));
		const skipped = allTasks.filter(
			(task) => inScope(task) && !counts(task)
		).length;

		if (specificIds && specificIds.length > 0) {
			const foundIds = tasks.map(idOf);
			const missing = specificIds.filter((id) => !foundIds.includes(id));
			if (tasks.length === 0) {
				warn(`No active tasks found with IDs: ${specificIds.join(', ')}`);
			} else if (missing.length > 0) {
				warn(
					`Some requested task IDs were not found or are not active: ${missing.join(', ')}`
				);
			}
		} else if (filtered && tasks.length === 0) {
			warn(`No active tasks found in range: ${first}-${last}`);
		}

		const meta = (extra: Partial<ComplexityReportMetadata> = {}) => ({
			generatedAt: new Date().toISOString(),
			tasksAnalyzed: tasks.length,
			...extra,
			thresholdScore: threshold,
			projectName: this.configManager.getProjectName(),
			usedResearch: useResearch
		});

		if (tasks.length === 0) {
			const existing = this.readExistingReport(reportPath);
			if (existing && filtered) {
				return {
					report: existing,
					reportPath,
					tag,
					analyses: [],
					skipped,
					kept: 0,
					unchanged: true,
					telemetryData: null
				};
			}
			const report = await this.saveReport(reportPath, (current) => ({
				meta: meta(),
				complexityAnalysis: current?.complexityAnalysis || []
			}));
			return {
				report,
				reportPath,
				tag,
				analyses: [],
				skipped,
				kept: 0,
				unchanged: false,
				telemetryData: null
			};
		}

		// A report that can't be read stops the run before the AI is paid for
		this.readExistingReport(reportPath);
		const aiConfig = new AiConfig(this.configManager, (level, message) =>
			level === 'warn' ? warn(message) : debug(message)
		);
		const gatheredContext = await this.gatherContext(allTasks, tasks, warn);
		const { systemPrompt, userPrompt } = getPromptManager().loadPrompt(
			'analyze-complexity',
			{
				tasks,
				gatheredContext,
				useResearch,
				hasCodebaseAnalysis: aiConfig.hasCodebaseAnalysis(
					useResearch,
					input.session
				),
				projectRoot
			},
			'default'
		);

		hooks.onAiCall?.({ taskCount: tasks.length });
		const response = await new AiService(aiConfig.toHost()).generateObject({
			role: useResearch ? 'research' : 'main',
			session: input.session,
			projectRoot,
			schema: COMMAND_SCHEMAS['analyze-complexity'],
			objectName: 'complexityAnalysis',
			systemPrompt,
			prompt: userPrompt,
			commandName: 'analyze-complexity',
			outputType: input.outputType ?? 'cli'
		});

		const returned = response?.mainResult?.complexityAnalysis;
		if (!Array.isArray(returned)) {
			throw new Error('AI service did not return a complexity analysis.');
		}
		const analyses: ComplexityAnalysisItem[] = [...returned];

		const answered = new Set(analyses.map((a) => String(a.taskId)));
		const unanswered = tasks.filter((t) => !answered.has(String(t.id)));
		if (unanswered.length > 0) {
			warn(
				`Missing analysis for ${unanswered.length} tasks: ${unanswered.map((t) => t.id).join(', ')}`
			);
			for (const task of unanswered) {
				analyses.push({
					taskId: task.id,
					taskTitle: task.title,
					complexityScore: 5,
					recommendedSubtasks: 3,
					expansionPrompt: `Break down this task with a focus on ${task.title.toLowerCase()}.`,
					reasoning:
						'Automatically added due to missing analysis in AI response.',
					placeholder: true
				});
			}
		}

		const tagTaskIds = new Set(allTasks.map((t) => String(t.id)));
		let kept = 0;
		// Merged under the file lock, so a report written meanwhile is kept
		const report = await this.saveReport(reportPath, (existing) => {
			const previous = (
				Array.isArray(existing?.complexityAnalysis)
					? existing.complexityAnalysis
					: []
			).filter((item) => tagTaskIds.has(String(item.taskId)));
			// A placeholder doesn't replace a real score from an earlier run
			const realIds = new Set(
				previous.filter((a) => !a.placeholder).map((a) => String(a.taskId))
			);
			const saved = analyses.filter(
				(a) => !(a.placeholder && realIds.has(String(a.taskId)))
			);
			const savedIds = new Set(saved.map((a) => String(a.taskId)));
			// Earlier entries of tasks still in this tag that this run didn't replace
			const earlier = previous.filter(
				(item) => !savedIds.has(String(item.taskId))
			);
			kept = earlier.length;
			const complexityAnalysis = [...earlier, ...saved];
			return {
				meta: meta({
					totalTasks: allTasks.length,
					analysisCount: complexityAnalysis.length
				}),
				complexityAnalysis
			};
		});
		if (aiConfig.debug) {
			debug(`Final analysis object: ${JSON.stringify(report, null, 2)}`);
		}

		return {
			report,
			reportPath,
			tag,
			analyses,
			skipped,
			kept,
			unchanged: false,
			telemetryData: response.telemetryData,
			tagInfo: response.tagInfo
		};
	}

	/**
	 * The tasks related to those analyzed, from the whole tag, as the legacy
	 * FuzzyTaskSearch and ContextGatherer found and formatted them
	 */
	private async gatherContext(
		allTasks: Task[],
		tasks: Task[],
		warn: (message: string) => void
	): Promise<string> {
		try {
			const ids = await findRelatedTaskIds(
				allTasks,
				tasks.map((t) => `${t.title} ${t.description}`).join(' '),
				MAX_RELATED_TASKS
			);
			return formatTasksContext(allTasks, ids);
		} catch (error) {
			warn(`Could not gather additional context: ${(error as Error).message}`);
			return '';
		}
	}

	/**
	 * The report at `reportPath`, or null when there is none. Throws when it
	 * exists but can't be read: writing over it would lose every entry in it.
	 */
	private readExistingReport(reportPath: string): ComplexityReportFile | null {
		try {
			return JSON.parse(fs.readFileSync(reportPath, 'utf8'));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
			throw Object.assign(
				new TaskGraphError(
					`Couldn't read the complexity report ${reportPath}: ${(error as Error).message}`,
					ERROR_CODES.PARSE_ERROR
				),
				{ hint: 'Fix the file, or move it aside to start a new report' }
			);
		}
	}

	/** Build the report from the one on disk and write it, both under the file lock */
	private async saveReport(
		reportPath: string,
		build: (existing: ComplexityReportFile | null) => ComplexityReportFile
	): Promise<ComplexityReportFile> {
		let report!: ComplexityReportFile;
		await new FileOperations().modifyJson(
			reportPath,
			(current: ComplexityReportFile) => {
				// modifyJson hands a new file over as {}
				report = build(
					current && Object.keys(current).length > 0 ? current : null
				);
				return report;
			}
		);
		return report;
	}
}
