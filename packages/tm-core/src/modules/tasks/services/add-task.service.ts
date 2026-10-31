/**
 * @fileoverview Add a task, written by the AI from a prompt or given as a
 * title and description. The AI call runs without the tasks.json lock; the
 * save re-reads the file under the lock and appends only the new task with
 * an ID that is free at that moment, so changes made during the call stay.
 */

import path from 'node:path';
import { TASKGRAPH_TASKS_FILE } from '../../../common/constants/paths.js';
import {
	ERROR_CODES,
	TaskGraphError
} from '../../../common/errors/taskgraph-error.js';
import type { IStorage } from '../../../common/interfaces/storage.interface.js';
import type { Task } from '../../../common/types/index.js';
import {
	AiService,
	type AiTagInfo,
	type AiTelemetryData
} from '../../ai/ai-service.js';
import { AiConfig } from '../../ai/config-ai-host.js';
import { getPromptManager } from '../../ai/prompts/prompt-manager.js';
import { COMMAND_SCHEMAS } from '../../ai/schemas/registry.js';
import { findTaskOrSubtask, gatherTaskContext } from '../../ai/task-context.js';
import type { ConfigManager } from '../../config/managers/config-manager.js';
import {
	assignMetadata,
	reconcileDependencySources
} from '../../dependencies/dependency-provenance.js';
import { mergeNewTaskDependencies } from '../../dependencies/new-task-dependencies.js';
import { setTaskLink } from '../../dependencies/task-links.js';
import { untrustLoopIfResearch } from '../../loop/untrust-after-research.js';
import { normalizeAcceptanceCriteria } from '../utils/acceptance-criteria.js';
import { nextTaskId, readArchivedIdsSync } from '../utils/archive.js';

/** How many tasks matching the prompt the AI is shown as context */
const MAX_RELATED_TASKS = 10;

const PRIORITIES = ['high', 'medium', 'low'];
const DEFAULT_PRIORITY = 'medium';

export interface AddTaskInput {
	/** What the task is; the AI writes it. Not needed with title and description */
	prompt?: string;
	title?: string;
	description?: string;
	details?: string;
	testStrategy?: string;
	/** Task or subtask IDs ("3", "3.2") in the target tag */
	dependencies?: Array<string | number>;
	/** high, medium or low; the config's defaultPriority when left out */
	priority?: string;
	/** Use the research role for the AI call */
	research?: boolean;
	/** Stored unchecked */
	acceptanceCriteria?: string[];
	/** The task this work was found while doing; a link that never blocks */
	discoveredFrom?: string | number;
	/** The active tag when left out */
	tag?: string;
	/** The MCP session, for its env */
	session?: unknown;
	/** 'cli' or 'mcp', for usage telemetry */
	outputType?: string;
}

/** Calls made while the task is added, so a caller can show progress */
export interface AddTaskHooks {
	/** A heads-up such as an AI-suggested dependency that doesn't exist */
	onWarning?: (message: string) => void;
	/** AI service detail, sent only with `global.debug` on */
	onDebug?: (message: string) => void;
	/** The AI call is about to start, with the tasks it will see */
	onAiCall?: (context: {
		dependencyIds: string[];
		relatedTaskIds: string[];
	}) => void;
}

export interface AddedTaskReference {
	id: string;
	/** Empty when the task can't be found */
	title: string;
	/** The AI added it; it wasn't passed in */
	addedByAi?: boolean;
}

export interface AddTaskResult {
	task: Task;
	tag: string;
	dependencies: AddedTaskReference[];
	/** Set when discoveredFrom isn't also a dependency */
	discoveredFrom?: AddedTaskReference;
	telemetryData: AiTelemetryData | null;
	tagInfo: AiTagInfo | null;
}

/** An error with the fix to suggest */
const withHint = (message: string, hint: string) =>
	Object.assign(new Error(message), { hint });

/** The title of a task ("3") or subtask ("3.2"), if it exists */
function findTitle(tasks: Task[], id: string): string | undefined {
	const found = findTaskOrSubtask(tasks, id);
	return (found?.subtask ?? found?.parent)?.title;
}

/**
 * The task `discoveredFrom` names, as a full ID ("3" or "3.2"). Checked
 * before any AI call so a typo costs nothing.
 */
function resolveDiscoveredFrom(
	id: string | number | undefined,
	tasks: Task[]
): string | undefined {
	if (id === undefined || id === null || id === '') return undefined;
	const text = String(id).trim();
	const hint = 'Run `taskgraph list` to see task IDs';
	if (!/^\d+(\.\d+)?$/.test(text)) {
		throw withHint(`"${text}" isn't a task ID`, hint);
	}
	const fullId = text
		.split('.')
		.map((part) => String(parseInt(part, 10)))
		.join('.');
	if (findTitle(tasks, fullId) === undefined) {
		throw withHint(`Task ${fullId} doesn't exist`, hint);
	}
	return fullId;
}

interface AiTaskData {
	title: string;
	description: string;
	details?: string | null;
	testStrategy?: string | null;
	dependencies?: Array<string | number> | null;
}

export class AddTaskService {
	constructor(
		private readonly storage: () => IStorage,
		private readonly configManager: ConfigManager
	) {}

	async add(
		input: AddTaskInput,
		hooks: AddTaskHooks = {}
	): Promise<AddTaskResult> {
		const warn = (message: string) => hooks.onWarning?.(message);
		const isManual = Boolean(input.title && input.description);
		if (!input.prompt && !isManual) {
			throw new TaskGraphError(
				'Either the prompt parameter or both title and description parameters are required for adding a task',
				ERROR_CODES.INVALID_INPUT
			);
		}

		const aiConfig = new AiConfig(this.configManager, (level, message) =>
			level === 'warn' ? warn(message) : hooks.onDebug?.(message)
		);
		const priority = this.resolvePriority(input.priority, aiConfig, warn);
		const tag = input.tag || this.configManager.getActiveTag();
		const storage = this.storage();

		// A missing file starts as an empty master tag; any other tag must exist
		const tags = await storage.getAllTags();
		if (!(tags.includes(tag) || (tags.length === 0 && tag === 'master'))) {
			throw new TaskGraphError(
				`Tag "${tag}" not found.`,
				ERROR_CODES.NOT_FOUND
			);
		}
		const tasks = await storage.loadTasks(tag);

		const discoveredFrom = resolveDiscoveredFrom(input.discoveredFrom, tasks);
		const tasksPath = path.join(
			this.configManager.getProjectRoot(),
			TASKGRAPH_TASKS_FILE
		);
		// Above every archived ID too, so an archived task's ID is never reused
		const { highestId } = readArchivedIdsSync(tasksPath, tag);
		const proposedId = nextTaskId(
			tasks.map((t) => t.id),
			highestId
		);

		// Dependencies resolve within the target tag only: task IDs repeat
		// across tags. A subtask ID such as 3.2 names that subtask
		const existingIds = tasks.flatMap((t) => [
			String(t.id),
			...(t.subtasks ?? []).map((s) => `${t.id}.${s.id}`)
		]);
		const explicit = mergeNewTaskDependencies({
			explicit: input.dependencies ?? [],
			existingIds
		});
		// Checked before any AI call or write, so a typo costs nothing
		const missing = explicit.missingExplicit;
		if (missing.length > 0) {
			const one = missing.length === 1;
			throw withHint(
				`${one ? 'Task' : 'Tasks'} ${missing.join(', ')} ${one ? "doesn't" : "don't"} exist in tag '${tag}'`,
				'Run `taskgraph list` to see task IDs'
			);
		}
		const explicitDependencies = explicit.dependencies;

		let taskData: AiTaskData;
		let telemetryData: AiTelemetryData | null = null;
		let tagInfo: AiTagInfo | null = null;
		if (isManual) {
			taskData = {
				title: input.title as string,
				description: input.description as string,
				details: input.details,
				testStrategy: input.testStrategy
			};
		} else {
			const result = await this.generate(
				{
					...input,
					prompt: input.prompt as string,
					priority,
					tasks,
					newTaskId: proposedId,
					dependencies: explicitDependencies.map(String)
				},
				aiConfig,
				hooks
			);
			({ taskData, telemetryData, tagInfo } = result);
		}

		// The dependencies passed in always stay; the AI's suggestions are
		// added to them, minus any with no task in the target tag
		const merged = mergeNewTaskDependencies({
			explicit: explicitDependencies,
			suggested: taskData.dependencies ?? [],
			existingIds
		});
		if (merged.missingSuggested.length > 0) {
			warn(
				`The AI suggested dependencies that don't exist (${merged.missingSuggested.join(', ')}); left them out`
			);
		}

		const newTask = {
			id: String(proposedId),
			title: taskData.title,
			description: taskData.description,
			details: taskData.details || '',
			testStrategy: taskData.testStrategy || '',
			status: 'pending',
			dependencies: merged.dependencies,
			priority,
			subtasks: []
		} as unknown as Task;
		const acceptanceCriteria = normalizeAcceptanceCriteria(
			input.acceptanceCriteria
		);
		if (acceptanceCriteria.length > 0) {
			newTask.acceptanceCriteria = acceptanceCriteria;
		}
		// Dependencies passed in stay explicit; any the AI added are inferred
		assignMetadata(
			newTask,
			reconcileDependencySources(newTask, {
				dependencies: explicitDependencies
			})
		);
		if (discoveredFrom) {
			assignMetadata(
				newTask,
				setTaskLink(newTask.metadata, discoveredFrom, 'discovered-from')
			);
		}

		// Re-reads the file under the lock; the ID changes if it was taken meanwhile
		const [saved] = await storage.appendTasks([newTask], tag);

		const explicitIds = new Set(explicitDependencies.map(String));
		const reference = (id: string | number): AddedTaskReference => ({
			id: String(id),
			title: findTitle(tasks, String(id)) ?? ''
		});
		return {
			task: saved,
			tag,
			dependencies: merged.dependencies.map((dep) => ({
				...reference(dep),
				addedByAi: !explicitIds.has(String(dep))
			})),
			discoveredFrom:
				discoveredFrom &&
				!merged.dependencies.some((dep) => String(dep) === discoveredFrom)
					? reference(discoveredFrom)
					: undefined,
			telemetryData,
			tagInfo
		};
	}

	private resolvePriority(
		priority: string | undefined,
		aiConfig: AiConfig,
		warn: (message: string) => void
	): string {
		if (!priority) {
			const configured = aiConfig.defaultPriority;
			if (configured === undefined) return DEFAULT_PRIORITY;
			if (PRIORITIES.includes(configured.toLowerCase())) {
				return configured.toLowerCase();
			}
			warn(
				`global.defaultPriority "${configured}" isn't high, medium or low. Using "${DEFAULT_PRIORITY}".`
			);
			return DEFAULT_PRIORITY;
		}
		const normalized = priority.toLowerCase();
		if (PRIORITIES.includes(normalized)) return normalized;
		throw withHint(`"${priority}" isn't a priority`, 'Use high, medium or low');
	}

	private async generate(
		request: AddTaskInput & {
			prompt: string;
			priority: string;
			tasks: Task[];
			newTaskId: number;
			dependencies: string[];
		},
		aiConfig: AiConfig,
		hooks: AddTaskHooks
	) {
		const { prompt, tasks, dependencies, session } = request;
		const useResearch = request.research === true;
		const projectRoot = this.configManager.getProjectRoot();
		const gathered = await gatherTaskContext(tasks, {
			query: prompt,
			maxResults: MAX_RELATED_TASKS,
			dependencyIds: dependencies
		});

		const { systemPrompt, userPrompt } = getPromptManager().loadPrompt(
			'add-task',
			{
				prompt,
				newTaskId: request.newTaskId,
				existingTasks: tasks,
				gatheredContext: gathered.context,
				contextFromArgs: '',
				useResearch,
				priority: request.priority,
				dependencies,
				hasCodebaseAnalysis: aiConfig.hasCodebaseAnalysis(useResearch, session),
				projectRoot
			}
		);

		// The AI sees only the first MAX_RELATED_TASKS of the tasks it matched
		hooks.onAiCall?.({
			dependencyIds: dependencies,
			relatedTaskIds: gathered.relevantTasks
				.slice(0, MAX_RELATED_TASKS)
				.map((task) => String(task.id))
				.filter((id) => !dependencies.includes(id))
		});

		const response = await new AiService(aiConfig.toHost()).generateObject({
			role: useResearch ? 'research' : 'main',
			session,
			projectRoot,
			schema: COMMAND_SCHEMAS['add-task'],
			objectName: 'newTaskData',
			systemPrompt,
			prompt: userPrompt,
			commandName: 'add-task',
			outputType: request.outputType ?? 'cli'
		});
		untrustLoopIfResearch(response, projectRoot);

		const result = response?.mainResult;
		const candidate = result?.task ?? result?.object?.task;
		const taskData: AiTaskData | undefined =
			candidate?.title && candidate?.description ? candidate : undefined;
		if (!taskData) {
			throw new Error(
				result
					? 'AI service did not return a valid task object.'
					: 'AI service did not return the expected object structure.'
			);
		}
		return {
			taskData,
			telemetryData: response.telemetryData,
			tagInfo: response.tagInfo
		};
	}
}
