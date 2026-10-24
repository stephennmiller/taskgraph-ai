/**
 * @fileoverview `update-subtask`: the AI writes notes for a subtask from your
 * prompt, and they are appended to its details as a timestamped
 * `<info added on …>` block. The AI call runs without the tasks.json lock;
 * the save re-reads the file under it and changes only that subtask, so
 * edits made during the call stay.
 *
 * The prompt inputs are built as the legacy
 * scripts/modules/task-manager/update-subtask-by-id.js built them.
 */

import {
	ERROR_CODES,
	TaskGraphError
} from '../../../common/errors/taskgraph-error.js';
import type { Subtask } from '../../../common/types/index.js';
import {
	AiService,
	type AiTagInfo,
	type AiTelemetryData
} from '../../ai/ai-service.js';
import { AiConfig } from '../../ai/config-ai-host.js';
import { getPromptManager } from '../../ai/prompts/prompt-manager.js';
import {
	findRelatedTaskIds,
	gatherTaskContext
} from '../../ai/task-context.js';
import type { ConfigManager } from '../../config/managers/config-manager.js';
import { withoutReservedMetadata } from '../../dependencies/dependency-provenance.js';
import type { TaskService } from './task-service.js';

/** How many tasks related to the prompt go into the context */
const MAX_RELATED_TASKS = 5;

export interface UpdateSubtaskInput {
	/** The subtask, as "parentId.subtaskId" ("5.2") */
	id: string;
	/** What the notes should cover; may be left out when `metadata` is given */
	prompt?: string;
	/** Use the research role */
	research?: boolean;
	/** Merged into the subtask's metadata (reserved keys are dropped) */
	metadata?: Record<string, unknown>;
	/** The active tag when left out */
	tag?: string;
	/** The MCP session, for its env */
	session?: unknown;
	/** 'cli' or 'mcp', for usage telemetry */
	outputType?: string;
}

/** Calls made while updating, so a caller can show progress */
export interface UpdateSubtaskHooks {
	/** A heads-up such as context that couldn't be gathered */
	onWarning?: (message: string) => void;
	/** AI service detail, sent only with `global.debug` on */
	onDebug?: (message: string) => void;
	/** The AI call is about to start */
	onAiCall?: (subtask: { id: string; title: string; research: boolean }) => void;
}

export interface UpdateSubtaskResult {
	/** The subtask ID, "5.2" */
	id: string;
	parentId: string;
	/** The subtask as saved, or as read when nothing was saved */
	subtask: Subtask;
	/** The notes appended, trimmed; empty when the AI returned none */
	added: string;
	telemetryData: AiTelemetryData | null;
	tagInfo: AiTagInfo | { tag: string } | null;
	tag: string;
}

const invalidId = (message: string) =>
	new TaskGraphError(message, ERROR_CODES.VALIDATION_ERROR);

/** "5.2" (or " 05.2 ") as "5.2"; throws for anything else */
function parseSubtaskId(value: string): {
	id: string;
	parentId: string;
	subId: string;
} {
	const id = String(value ?? '').trim();
	if (!id) throw invalidId('Subtask ID cannot be empty.');
	if (!id.includes('.')) {
		throw invalidId(
			`Invalid subtask ID format: ${id}. Subtask ID must be in format "parentId.subtaskId" (e.g., "5.2").`
		);
	}
	const parts = id.split('.');
	const positive = (part: string) => /^\d+$/.test(part) && Number(part) > 0;
	if (parts.length !== 2 || !parts.every(positive)) {
		throw invalidId(
			`Invalid subtask ID format: ${id}. Both parent ID and subtask ID must be positive integers.`
		);
	}
	const [parentId, subId] = parts.map((p) => String(Number(p)));
	return { id: `${parentId}.${subId}`, parentId, subId };
}

export class UpdateSubtaskService {
	constructor(
		private readonly taskService: TaskService,
		private readonly configManager: ConfigManager
	) {}

	async updateSubtask(
		input: UpdateSubtaskInput,
		hooks: UpdateSubtaskHooks = {}
	): Promise<UpdateSubtaskResult> {
		const warn = (message: string) => hooks.onWarning?.(message);
		const metadata = withoutReservedMetadata(input.metadata);
		const prompt = typeof input.prompt === 'string' ? input.prompt : '';
		const { id, parentId, subId } = parseSubtaskId(input.id);
		if (!prompt.trim() && !metadata) {
			throw new TaskGraphError(
				'Prompt cannot be empty unless metadata is provided. Please provide context for the subtask update or metadata to merge.',
				ERROR_CODES.VALIDATION_ERROR
			);
		}

		const { tasks, tag } = await this.taskService.loadStoredTasks(input.tag);
		const parent = tasks.find((t) => String(t.id) === parentId);
		if (!parent) {
			throw new TaskGraphError(
				`Task ${parentId} not found`,
				ERROR_CODES.TASK_NOT_FOUND
			);
		}
		const subtasks = parent.subtasks;
		if (!Array.isArray(subtasks)) {
			throw new TaskGraphError(
				`Parent task ${parentId} has no subtasks.`,
				ERROR_CODES.TASK_NOT_FOUND
			);
		}
		const index = subtasks.findIndex((s) => String(s.id) === subId);
		if (index === -1) {
			throw Object.assign(
				new TaskGraphError(`Subtask ${id} not found`, ERROR_CODES.TASK_NOT_FOUND),
				{ hint: `Run \`taskgraph show ${parentId}\` to see its subtasks` }
			);
		}
		const subtask = subtasks[index];
		const mergeMetadata = (item: { metadata?: Record<string, unknown> }) =>
			metadata ? { metadata: { ...(item.metadata ?? {}), ...metadata } } : {};

		if (!prompt.trim()) {
			const saved = await this.taskService.modifyTask(id, mergeMetadata, tag);
			return {
				id,
				parentId,
				subtask: saved as Subtask,
				added: '',
				telemetryData: null,
				tagInfo: { tag },
				tag
			};
		}

		let gatheredContext = '';
		try {
			const related = await findRelatedTaskIds(
				tasks,
				`${parent.title} ${subtask.title} ${prompt}`,
				MAX_RELATED_TASKS
			);
			const taskIds = [...new Set([id, ...related])];
			gatheredContext = (await gatherTaskContext(tasks, { taskIds })).context;
		} catch (error) {
			warn(`Could not gather context: ${(error as Error).message}`);
		}

		const useResearch = input.research === true;
		const neighbour = (s: Subtask | undefined) =>
			s && { id: `${parent.id}.${s.id}`, title: s.title, status: s.status };
		const aiConfig = new AiConfig(this.configManager, (level, message) =>
			level === 'warn' ? warn(message) : hooks.onDebug?.(message)
		);
		const projectRoot = this.configManager.getProjectRoot();
		const { systemPrompt, userPrompt } = getPromptManager().loadPrompt(
			'update-subtask',
			{
				// A number, as the legacy reader held it; the prompt prints it as JSON
				parentTask: { id: Number(parentId), title: parent.title },
				prevSubtask: neighbour(subtasks[index - 1]),
				nextSubtask: neighbour(subtasks[index + 1]),
				currentDetails: subtask.details || '(No existing details)',
				updatePrompt: prompt,
				useResearch,
				gatheredContext,
				hasCodebaseAnalysis: aiConfig.hasCodebaseAnalysis(
					useResearch,
					input.session
				),
				projectRoot
			},
			// The template has no research variant: useResearch above covers it
			'default'
		);

		hooks.onAiCall?.({ id, title: subtask.title, research: useResearch });
		const response = await new AiService(aiConfig.toHost()).generateText({
			role: useResearch ? 'research' : 'main',
			session: input.session,
			projectRoot,
			systemPrompt,
			prompt: userPrompt,
			commandName: 'update-subtask',
			outputType: input.outputType ?? 'cli'
		});
		const added =
			typeof response?.mainResult === 'string'
				? response.mainResult.trim()
				: '';

		// An empty answer saves nothing but the metadata you passed
		// As the legacy command did, a short prompt marks the description
		const stamp = (item: { description?: string }) =>
			item.description && prompt.length < 100
				? {
						description: `${item.description} [Updated: ${new Date().toLocaleDateString()}]`
					}
				: {};
		let saved: Subtask = subtask;
		if (added) {
			const appended = await this.taskService.appendToDetails(
				id,
				added,
				tag,
				(item) => ({ ...stamp(item), ...mergeMetadata(item) })
			);
			saved = appended.saved as Subtask;
		} else if (metadata) {
			saved = (await this.taskService.modifyTask(
				id,
				mergeMetadata,
				tag
			)) as Subtask;
		}

		return {
			id,
			parentId,
			subtask: saved,
			added,
			telemetryData: response.telemetryData,
			tagInfo: response.tagInfo,
			tag
		};
	}
}
