/**
 * @fileoverview `research`: ask the research model a question with project
 * context (tasks, files, the project tree, your notes), and optionally save
 * the answer to a task's details or a markdown file. Every task ID and file
 * is checked before the AI call, so a typo costs nothing. A save to a task
 * is one locked write that changes only that task's details.
 */

import fs from 'node:fs';
import path from 'node:path';
import { TASKGRAPH_DOCS_DIR } from '../../../common/constants/paths.js';
import {
	ERROR_CODES,
	TaskGraphError
} from '../../../common/errors/taskgraph-error.js';
import {
	realpathOfExistingPrefix,
	resolvePathInsideRoot
} from '../../../common/utils/path-inside-root.js';
import {
	AiService,
	type AiTagInfo,
	type AiTelemetryData
} from '../../ai/ai-service.js';
import { AiConfig } from '../../ai/config-ai-host.js';
import {
	type FileContextEntry,
	type ProjectTreeEntry,
	estimateTokens,
	gatherFileContext,
	gatherProjectTree,
	resolveContextFile
} from '../../ai/project-context.js';
import { getPromptManager } from '../../ai/prompts/prompt-manager.js';
import { findTaskOrSubtask, gatherTaskContext } from '../../ai/task-context.js';
import type { ConfigManager } from '../../config/managers/config-manager.js';
import type { TaskService } from './task-service.js';

/** How many tasks matching the question go into the context */
const MAX_RELATED_TASKS = 8;
const DETAIL_LEVELS = ['low', 'medium', 'high'];

/** One question and its answer */
export interface ResearchExchange {
	question: string;
	answer: string;
	type: 'initial' | 'followup';
	timestamp: string;
}

export interface ResearchInput {
	query: string;
	/** Tasks or subtasks ("15", "16.2") whose details go into the context */
	taskIds?: string[];
	/** Files, relative to the project root or absolute, inside the project */
	filePaths?: string[];
	/** Notes of your own for the context */
	customContext?: string;
	includeProjectTree?: boolean;
	/** low, medium (the default) or high */
	detailLevel?: string;
	/** Append the answer to this task's or subtask's details */
	saveTo?: string;
	/** Save the answer to .taskgraph/docs/research/ */
	saveToFile?: boolean;
	/** Write the answer as markdown to this path, inside the project */
	saveAs?: string;
	/**
	 * The questions and answers so far, for a follow-up question: the model
	 * sees them as context
	 */
	history?: ResearchExchange[];
	/** The active tag when left out */
	tag?: string;
	/** The MCP session, for its env */
	session?: unknown;
	/** 'cli' or 'mcp', for usage telemetry */
	outputType?: string;
}

/** Calls made while researching, so a caller can show progress */
export interface ResearchHooks {
	/** A heads-up such as a file left out of the context */
	onWarning?: (message: string) => void;
	/** AI service detail, sent only with `global.debug` on */
	onDebug?: (message: string) => void;
	/** The AI call is about to start, with the context it gets */
	onAiCall?: (context: {
		taskIds: string[];
		relatedTaskIds: string[];
		files: string[];
		projectTree: boolean;
		customContext: boolean;
	}) => void;
}

interface ResearchTokenBreakdown {
	total: number;
	customContext: { tokens: number; characters: number } | null;
	tasks: Array<{
		id: string;
		type: 'task' | 'subtask';
		title: string;
		parentTitle?: string;
		tokens: number;
		characters: number;
	}>;
	files: FileContextEntry[];
	projectTree: ProjectTreeEntry | null;
}

/** A save that failed after the answer came back */
export type ResearchSaveFailure =
	| { kind: 'task'; id: string; message: string }
	| { kind: 'file'; path: string; message: string };

export interface ResearchResult {
	query: string;
	/** The answer, without the model's <think> reasoning */
	result: string;
	contextSize: number;
	contextTokens: number;
	tokenBreakdown: ResearchTokenBreakdown;
	systemPromptTokens: number;
	userPromptTokens: number;
	totalInputTokens: number;
	detailLevel: string;
	telemetryData: AiTelemetryData | null;
	tagInfo: AiTagInfo | null;
	tag: string;
	/** The task IDs you passed */
	taskIds: string[];
	/** Tasks found by searching for the question */
	relatedTaskIds: string[];
	/** This question and answer, for the history of a follow-up */
	exchange: ResearchExchange;
	/** The task saveTo saved to */
	savedTo?: { id: string; title: string };
	/** The file saveToFile wrote, absolute */
	savedFilePath?: string;
	/** The file saveAs wrote, absolute */
	savedAs?: string;
	saveFailures: ResearchSaveFailure[];
}

/** Where saveResearch saved a conversation */
export type ResearchSaved =
	| { kind: 'task'; id: string; title: string }
	| { kind: 'file'; path: string };

/** Whether `id` looks like a task ("15") or subtask ("15.2") ID */
export const isTaskOrSubtaskId = (id: string): boolean =>
	/^\d+(\.\d+)?$/.test(id);

const withHint = (error: TaskGraphError, hint: string) =>
	Object.assign(error, { hint });

/** Remove the model's <think>…</think> reasoning, keeping only the answer */
const stripThinking = (text: string) =>
	text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

/** The earlier exchanges as context for a follow-up question */
function conversationContext(history: ResearchExchange[]): string {
	const parts = ['--- Conversation History ---'];
	history.forEach((exchange, index) => {
		const initial = exchange.type === 'initial';
		parts.push(
			`\n${initial ? 'Initial Question' : `Follow-up ${index}`}: ${exchange.question}`
		);
		parts.push(
			`${initial ? 'Initial Answer' : `Answer ${index}`}: ${exchange.answer}`
		);
	});
	return parts.join('\n');
}

/** A conversation as appended to a task's details */
function conversationForTask(history: ResearchExchange[]): string {
	const now = new Date();
	let text = `## Research Session - ${now.toLocaleDateString()} ${now.toLocaleTimeString()}\n\n`;
	history.forEach((exchange, index) => {
		text +=
			exchange.type === 'initial'
				? `**Initial Query:** ${exchange.question}\n\n`
				: `**Follow-up ${index}:** ${exchange.question}\n\n`;
		text += `**Response:** ${exchange.answer}\n\n`;
		if (index < history.length - 1) text += '---\n\n';
	});
	return text;
}

/** A conversation as a markdown file with front matter */
function conversationForFile(history: ResearchExchange[]): string {
	const now = new Date();
	const timestamp = now.toISOString();
	const first = history[0]?.question ?? '';
	let content = `---
title: Research Session
query: "${first}"
date: ${now.toLocaleDateString()}
time: ${now.toLocaleTimeString()}
timestamp: ${timestamp}
exchanges: ${history.length}
---

# Research Session

`;
	history.forEach((exchange, index) => {
		content +=
			exchange.type === 'initial'
				? '## Initial Query\n\n'
				: `## Follow-up ${index}\n\n`;
		content += `**Question:** ${exchange.question}\n\n**Response:**\n\n${exchange.answer}\n\n`;
		if (index < history.length - 1) content += '---\n\n';
	});
	content += `\n---\n\n*Generated by TaskGraph Research Command*  \n*Timestamp: ${timestamp}*\n`;
	return content;
}

/** `.taskgraph/docs/research/<date>_<slug of the first question>.md` */
function researchFilePath(projectRoot: string, question: string): string {
	const slug = (question || 'research-query')
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, '')
		.replace(/\s+/g, '-')
		.replace(/-+/g, '-')
		.substring(0, 50)
		.replace(/^-+|-+$/g, '');
	const date = new Date().toISOString().split('T')[0];
	return path.join(
		projectRoot,
		TASKGRAPH_DOCS_DIR,
		'research',
		`${date}_${slug}.md`
	);
}

function writeFile(file: string, content: string): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content, 'utf8');
}

export class ResearchService {
	constructor(
		private readonly taskService: TaskService,
		private readonly configManager: ConfigManager
	) {}

	private get projectRoot(): string {
		return this.configManager.getProjectRoot();
	}

	async research(
		input: ResearchInput,
		hooks: ResearchHooks = {}
	): Promise<ResearchResult> {
		const warn = (message: string) => hooks.onWarning?.(message);
		const query = String(input.query ?? '').trim();
		if (!query) {
			throw new TaskGraphError(
				'Research needs a question',
				ERROR_CODES.INVALID_INPUT
			);
		}
		const detailLevel = (input.detailLevel || 'medium').toLowerCase();
		if (!DETAIL_LEVELS.includes(detailLevel)) {
			throw new TaskGraphError(
				`Detail level must be low, medium or high, not "${input.detailLevel}"`,
				ERROR_CODES.INVALID_INPUT
			);
		}

		const projectRoot = this.projectRoot;
		const tag = input.tag || this.configManager.getActiveTag();
		const storage = this.taskService.getStorage();
		// A missing file reads as an empty master tag; any other tag must exist
		const tags = await storage.getAllTags();
		if (!(tags.includes(tag) || (tags.length === 0 && tag === 'master'))) {
			throw new TaskGraphError(
				`Tag "${tag}" not found.`,
				ERROR_CODES.NOT_FOUND
			);
		}
		const tasks = tags.length === 0 ? [] : await storage.loadTasks(tag);

		// Every ID, file and path is checked before spending an AI call
		const taskIds = (input.taskIds ?? []).map((id) => String(id).trim());
		// An empty saveTo means don't save, as legacy MCP treated it
		const saveTo = input.saveTo?.trim() || undefined;
		for (const id of [...taskIds, ...(saveTo !== undefined ? [saveTo] : [])]) {
			if (!isTaskOrSubtaskId(id)) {
				throw withHint(
					new TaskGraphError(
						`"${id}" isn't a task ID`,
						ERROR_CODES.INVALID_INPUT
					),
					'Use a task ID like 15, or 15.2 for a subtask'
				);
			}
			if (!findTaskOrSubtask(tasks, id)) {
				throw withHint(
					new TaskGraphError(
						`${id.includes('.') ? 'Subtask' : 'Task'} ${id} doesn't exist in tag '${tag}'`,
						ERROR_CODES.TASK_NOT_FOUND
					),
					'Run `taskgraph list` to see task IDs'
				);
			}
		}
		const filePaths = input.filePaths ?? [];
		const files = filePaths.map((file) =>
			resolveContextFile(projectRoot, file)
		);
		const saveAs =
			input.saveAs === undefined ? undefined : this.resolveSaveAs(input.saveAs);

		// A follow-up sees the conversation so far, before your own notes
		const notes = input.customContext?.trim() ?? '';
		const customContext = input.history?.length
			? conversationContext(input.history) +
				(notes ? `\n\n--- Original Context ---\n${notes}` : '')
			: notes;

		const gathered = await gatherTaskContext(tasks, {
			query,
			maxResults: MAX_RELATED_TASKS,
			taskIds
		});
		const relatedTaskIds = gathered.relevantTasks
			.slice(0, MAX_RELATED_TASKS)
			.map((task) => String(task.id))
			.filter((id) => !taskIds.includes(id));

		const breakdown: ResearchTokenBreakdown = {
			total: 0,
			customContext: null,
			tasks: [],
			files: [],
			projectTree: null
		};
		const sections: string[] = [];
		if (customContext) {
			const section = `## Additional Context\n\n${customContext}`;
			sections.push(section);
			breakdown.customContext = {
				tokens: estimateTokens(section),
				characters: section.length
			};
		}
		if (gathered.context) {
			sections.push(gathered.context);
			breakdown.tasks = gathered.items.map(({ text, ...item }) => ({
				...item,
				tokens: estimateTokens(text),
				characters: text.length
			}));
		}
		const fileContext = gatherFileContext(projectRoot, files, warn);
		if (fileContext.context) {
			sections.push(fileContext.context);
			breakdown.files = fileContext.breakdown;
		}
		let treeGathered = false;
		if (input.includeProjectTree) {
			const tree = gatherProjectTree(projectRoot);
			if (tree.context) {
				sections.push(tree.context);
				breakdown.projectTree = tree.breakdown;
				treeGathered = true;
			} else {
				warn(`Could not read the project tree at ${projectRoot}`);
			}
		}
		breakdown.total =
			(breakdown.customContext?.tokens ?? 0) +
			breakdown.tasks.reduce((sum, t) => sum + t.tokens, 0) +
			breakdown.files.reduce((sum, f) => sum + f.tokens, 0) +
			(breakdown.projectTree?.tokens ?? 0);
		const gatheredContext = sections.join('\n\n---\n\n');

		const { systemPrompt, userPrompt } = getPromptManager().loadPrompt(
			'research',
			{
				query,
				gatheredContext,
				detailLevel,
				projectInfo: {
					root: projectRoot,
					taskCount: taskIds.length + relatedTaskIds.length,
					fileCount: filePaths.length
				}
			}
		);

		hooks.onAiCall?.({
			taskIds,
			relatedTaskIds,
			files: filePaths,
			projectTree: treeGathered,
			customContext: Boolean(notes)
		});

		const aiConfig = new AiConfig(this.configManager, (level, message) =>
			level === 'warn' ? warn(message) : hooks.onDebug?.(message)
		);
		const response = await new AiService(aiConfig.toHost()).generateText({
			role: 'research',
			session: input.session,
			projectRoot,
			systemPrompt,
			prompt: userPrompt,
			commandName: 'research',
			outputType: input.outputType ?? 'cli'
		});
		const answer = stripThinking(
			typeof response?.mainResult === 'string' ? response.mainResult : ''
		);

		const systemPromptTokens = estimateTokens(systemPrompt);
		const userPromptTokens = estimateTokens(userPrompt);
		const exchange: ResearchExchange = {
			question: query,
			answer,
			type: input.history?.length ? 'followup' : 'initial',
			timestamp: new Date().toISOString()
		};
		const result: ResearchResult = {
			query,
			result: answer,
			contextSize: gatheredContext.length,
			contextTokens: breakdown.total,
			tokenBreakdown: breakdown,
			systemPromptTokens,
			userPromptTokens,
			totalInputTokens: systemPromptTokens + userPromptTokens,
			detailLevel,
			telemetryData: response.telemetryData,
			tagInfo: response.tagInfo,
			tag,
			taskIds,
			relatedTaskIds,
			exchange,
			saveFailures: []
		};

		// The answer is kept whatever happens to a save
		if (saveTo !== undefined) {
			try {
				const saved = await this.saveResearch(
					[exchange],
					{ taskId: saveTo, text: `## Research: ${query}\n\n${answer}` },
					tag
				);
				if (saved.kind === 'task') {
					result.savedTo = { id: saved.id, title: saved.title };
				}
			} catch (error) {
				result.saveFailures.push({
					kind: 'task',
					id: saveTo,
					message: (error as Error).message
				});
			}
		}
		if (input.saveToFile) {
			try {
				const saved = await this.saveResearch([exchange], { file: true }, tag);
				if (saved.kind === 'file') {
					result.savedFilePath = path.join(projectRoot, saved.path);
				}
			} catch (error) {
				result.saveFailures.push({
					kind: 'file',
					path: '',
					message: (error as Error).message
				});
			}
		}
		if (saveAs) {
			try {
				writeFile(saveAs, `# Research: ${query}\n\n${answer}\n`);
				result.savedAs = saveAs;
			} catch (error) {
				result.saveFailures.push({
					kind: 'file',
					path: path.relative(projectRoot, saveAs),
					message: (error as Error).message
				});
			}
		}
		return result;
	}

	/**
	 * Save a conversation: appended to a task's or subtask's details in one
	 * locked write (`text` replaces the formatted conversation), or written
	 * to .taskgraph/docs/research/. Throws when the task doesn't exist.
	 * @returns Where it saved; a file path is relative to the project root
	 */
	async saveResearch(
		history: ResearchExchange[],
		target: { taskId: string; text?: string } | { file: true },
		tag?: string
	): Promise<ResearchSaved> {
		if ('file' in target) {
			const file = researchFilePath(this.projectRoot, history[0]?.question);
			writeFile(file, conversationForFile(history));
			return { kind: 'file', path: path.relative(this.projectRoot, file) };
		}
		const id = target.taskId.trim();
		if (!isTaskOrSubtaskId(id)) {
			throw new TaskGraphError(
				`"${id}" isn't a task ID like 15 or 15.2`,
				ERROR_CODES.INVALID_INPUT
			);
		}
		const { saved } = await this.taskService.appendToDetails(
			id,
			(target.text ?? conversationForTask(history)).trim(),
			tag || this.configManager.getActiveTag()
		);
		return { kind: 'task', id, title: saved.title };
	}

	/** The absolute path saveAs writes, refused when it leaves the project */
	private resolveSaveAs(saveAs: string): string {
		const root = realpathOfExistingPrefix(path.resolve(this.projectRoot));
		const resolved = saveAs.trim()
			? resolvePathInsideRoot(root, saveAs.trim())
			: null;
		if (!resolved) {
			throw new TaskGraphError(
				`Can't save to "${saveAs}": the file must be inside the project`,
				ERROR_CODES.INVALID_INPUT
			);
		}
		if (fs.statSync(resolved, { throwIfNoEntry: false })?.isDirectory()) {
			throw new TaskGraphError(
				`Can't save to "${saveAs}": it's a folder, name a file`,
				ERROR_CODES.INVALID_INPUT
			);
		}
		return resolved;
	}
}
