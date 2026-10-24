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
import { complexityReportPath } from '../../reports/managers/complexity-report-manager.js';
import type { ComplexityReportMetadata } from '../../reports/types.js';
import { normalizeTaskStatus } from '../utils/legacy-status.js';

/** How many related tasks go into the prompt's project context */
const MAX_RELATED_TASKS = 10;

const ACTIVE_STATUSES = ['pending', 'blocked', 'in-progress'];

/** One task's entry in the report, as the AI writes it */
export interface ComplexityAnalysisEntry {
	taskId: number | string;
	taskTitle: string;
	complexityScore: number;
	recommendedSubtasks: number;
	expansionPrompt: string;
	reasoning: string;
}

export interface ComplexityReportFile {
	meta: ComplexityReportMetadata;
	complexityAnalysis: ComplexityAnalysisEntry[];
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
	/** The entries this run wrote */
	analyses: ComplexityAnalysisEntry[];
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

/** Report file names older versions wrote, newest first */
const REPORT_NAMES = [
	'task-complexity-report',
	'task-complexity',
	'complexity-report'
];

/**
 * A complexity report: `file` (relative to the project root) when given,
 * else the tag's report under .taskgraph/reports, under any name older
 * versions used. Null when there is none; throws when it isn't valid JSON.
 */
export function readComplexityReport(
	projectRoot: string,
	{ tag, file }: { tag?: string; file?: string }
): { report: ComplexityReportFile; reportPath: string } | null {
	const candidates = file
		? [path.resolve(projectRoot, file)]
		: REPORT_NAMES.map((name) =>
				complexityReportPath(projectRoot, tag).replace(
					'task-complexity-report',
					name
				)
			);
	const reportPath = candidates.find((candidate) => fs.existsSync(candidate));
	if (!reportPath) return null;
	try {
		return { report: JSON.parse(fs.readFileSync(reportPath, 'utf8')), reportPath };
	} catch (error) {
		throw new TaskGraphError(
			`Couldn't read the complexity report: ${(error as Error).message}`,
			ERROR_CODES.PARSE_ERROR
		);
	}
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
		const specificIds = input.ids
			? input.ids
					.split(',')
					.map((id) => parseInt(id.trim(), 10))
					.filter((id) => !Number.isNaN(id))
			: null;
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
		const tasks = allTasks.filter((task) => isActive(task) && inScope(task));
		const skipped = allTasks.filter(
			(task) => inScope(task) && !isActive(task)
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
			projectName: this.projectName,
			usedResearch: useResearch
		});

		if (tasks.length === 0) {
			const existing = this.readExistingReport(reportPath, warn);
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
			const report = {
				meta: meta(),
				complexityAnalysis: existing?.complexityAnalysis || []
			};
			this.writeReport(reportPath, report);
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
		const analyses: ComplexityAnalysisEntry[] = [...returned];

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
						'Automatically added due to missing analysis in AI response.'
				});
			}
		}

		// Read now, not before the AI call, so a report written meanwhile is kept
		const existing = this.readExistingReport(reportPath, warn);
		const analyzedIds = new Set(analyses.map((a) => String(a.taskId)));
		const tagTaskIds = new Set(allTasks.map((t) => String(t.id)));
		// Earlier entries of tasks still in this tag that this run didn't analyze
		const earlier = (
			Array.isArray(existing?.complexityAnalysis)
				? existing.complexityAnalysis
				: []
		).filter(
			(item) =>
				!analyzedIds.has(String(item.taskId)) &&
				tagTaskIds.has(String(item.taskId))
		);
		const complexityAnalysis = [...earlier, ...analyses];
		const report = {
			meta: meta({
				totalTasks: allTasks.length,
				analysisCount: complexityAnalysis.length
			}),
			complexityAnalysis
		};
		this.writeReport(reportPath, report);
		if (aiConfig.debug) {
			debug(`Final analysis object: ${JSON.stringify(report, null, 2)}`);
		}

		return {
			report,
			reportPath,
			tag,
			analyses,
			skipped,
			kept: earlier.length,
			unchanged: false,
			telemetryData: response.telemetryData,
			tagInfo: response.tagInfo
		};
	}

	/** global.projectName, as the legacy getProjectName read it */
	private get projectName(): string {
		const config = this.configManager.getConfig() as {
			global?: { projectName?: unknown };
		};
		const name = config.global?.projectName;
		return typeof name === 'string' ? name : 'TaskGraph';
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

	/** The report at `reportPath`, or null when there is none or it can't be read */
	private readExistingReport(
		reportPath: string,
		warn: (message: string) => void
	): ComplexityReportFile | null {
		try {
			return JSON.parse(fs.readFileSync(reportPath, 'utf8'));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				warn(
					`Could not read existing report: ${(error as Error).message}; writing a new one`
				);
			}
			return null;
		}
	}

	private writeReport(reportPath: string, report: ComplexityReportFile) {
		fs.mkdirSync(path.dirname(reportPath), { recursive: true });
		fs.writeFileSync(reportPath, JSON.stringify(report, null, '\t'), 'utf8');
	}
}
