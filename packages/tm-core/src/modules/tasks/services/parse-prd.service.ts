/**
 * @fileoverview Generate a tag's tasks from a PRD with the AI (`parse-prd`),
 * and find the gaps worth asking about first (`--clarify`). With `append`
 * only the PRD sections added since the last parse go to the AI. The AI
 * call runs without the tasks.json lock; the save re-reads the tag under it,
 * so tasks added or changed during the call survive an append.
 *
 * The parse-prd prompt is eval-gated: its inputs are built exactly as the
 * legacy scripts/modules/task-manager/parse-prd/ built them.
 */

import fs from 'node:fs';
import path from 'node:path';
import { inspect } from 'node:util';
import {
	TASKGRAPH_DOCS_DIR,
	TASKGRAPH_TASKS_FILE
} from '../../../common/constants/paths.js';
import {
	ERROR_CODES,
	TaskGraphError
} from '../../../common/errors/taskgraph-error.js';
import type { Task } from '../../../common/types/index.js';
import { stripTerminalControls } from '../../../common/utils/terminal-text.js';
import { neutralizeTag } from '../../../common/utils/prompt-tag.js';
import {
	AiService,
	type AiTagInfo,
	type AiTelemetryData
} from '../../ai/ai-service.js';
import { AiConfig, type AiReport } from '../../ai/config-ai-host.js';
import { estimateTokens } from '../../ai/project-context.js';
import { getPromptManager } from '../../ai/prompts/prompt-manager.js';
import { COMMAND_SCHEMAS } from '../../ai/schemas/registry.js';
import type { ConfigManager } from '../../config/managers/config-manager.js';
import {
	type ClarifyingQuestion,
	MAX_CLARIFYING_QUESTIONS,
	normalizeClarifyingQuestions
} from '../../prd/clarifications.js';
import { formatExistingTaskList } from '../../prd/generated-tasks.js';
import {
	PRD_SNAPSHOT_KEY,
	type PrdDelta,
	type PrdSnapshot,
	buildPrdSnapshot,
	diffPrdSections,
	getPrdSnapshot,
	hasPrdChanges,
	prdDeltaContent,
	withPrdSnapshot
} from '../../prd/prd-deltas.js';
import {
	formatPrdSectionList,
	parsePrdSections,
	prdPathForSource
} from '../../prd/prd-sections.js';
import { nextTaskId, readArchivedIdsSync } from '../utils/archive.js';
import { prepareGeneratedTasks } from '../utils/prd-tasks.js';
import { isReservedNewTagName } from '../utils/tag-names.js';
import {
	type ParsePrdGenerateHooks,
	generatePrdTasks,
	parsePrdServiceParams
} from './parse-prd-generate.js';
import type { TaskService } from './task-service.js';

/** Where parse-prd looks for a PRD when none is named */
const DEFAULT_PRD_FILES = ['PRD.md', 'prd.md', 'PRD.txt', 'prd.txt'].map(
	(name) => path.join(TASKGRAPH_DOCS_DIR, name)
);

interface PrdInput {
	/** Absolute, or relative to the project root; else the first of .taskgraph/docs/{PRD.md,prd.md,PRD.txt,prd.txt} */
	prdPath?: string;
	/** Use the research role */
	research?: boolean;
	/** The MCP session, for its env */
	session?: unknown;
	/** 'cli' or 'mcp', for usage telemetry */
	outputType?: string;
}

export interface ParsePrdInput extends PrdInput {
	/** About how many tasks; 0 lets the AI size the list. Else global.defaultNumTasks */
	numTasks?: number | string;
	/** Replace the tag's tasks */
	force?: boolean;
	/** Add to the tag's tasks; for a PRD parsed before, only its new sections */
	append?: boolean;
	/** The active tag when left out; a tag that doesn't exist is created */
	tag?: string;
	/** Stream the task list (onPartial) instead of one request */
	stream?: boolean;
}

interface PrdLogHooks {
	/** A heads-up, such as a numTasks that isn't a number or a config problem */
	onWarning?: (message: string) => void;
	/** AI service detail and the full error on failure, sent only with `global.debug` on */
	onDebug?: (message: string) => void;
}

const reportTo =
	(hooks: PrdLogHooks): AiReport =>
	(level, message) =>
		level === 'warn' ? hooks.onWarning?.(message) : hooks.onDebug?.(message);

export interface ParsePrdHooks extends ParsePrdGenerateHooks, PrdLogHooks {
	/** With append: what changed in a PRD parsed before, before any AI call */
	onPrdDelta?: (delta: PrdDelta) => void;
}

export interface ParsePrdResult {
	tag: string;
	/** The PRD read, absolute */
	prdPath: string;
	/** The tasks file written, absolute */
	tasksPath: string;
	/** How many tasks were added */
	added: number;
	/** The tag's tasks after the save */
	total: number;
	/** With append, for a PRD parsed before: what changed since */
	prdDelta: PrdDelta | null;
	/** Null without an AI call (an append with no new sections) */
	telemetryData: AiTelemetryData | null;
	tagInfo: AiTagInfo | null;
	/** The prompt's size in tokens, roughly; 0 without an AI call */
	estimatedInputTokens: number;
}

export interface PrdGapsResult {
	prdPath: string;
	/** At most five, none the PRD's Clarifications section already answers */
	questions: ClarifyingQuestion[];
	telemetryData: AiTelemetryData | null;
}

/** The PRD's section hashes this parse records, so the next append can tell what changed */
interface SnapshotUpdate {
	path: string;
	snapshot: PrdSnapshot;
	/** Drop other PRDs' hashes: their tasks were just replaced */
	replace: boolean;
}

export class ParsePrdService {
	constructor(
		private readonly taskService: TaskService,
		private readonly configManager: ConfigManager
	) {}

	private get projectRoot(): string {
		return this.configManager.getProjectRoot();
	}

	private get tasksPath(): string {
		return path.join(this.projectRoot, TASKGRAPH_TASKS_FILE);
	}

	/** The PRD to read: the one named, else the first default that exists */
	resolvePrdPath(prdPath?: string): string {
		if (prdPath) {
			const resolved = path.resolve(this.projectRoot, prdPath);
			if (!fs.existsSync(resolved)) {
				throw new TaskGraphError(
					`${prdPath} not found`,
					ERROR_CODES.FILE_NOT_FOUND
				);
			}
			return resolved;
		}
		const found = DEFAULT_PRD_FILES.map((file) =>
			path.join(this.projectRoot, file)
		).find((file) => fs.existsSync(file));
		if (!found) {
			throw new TaskGraphError(
				`Required PRD file not found. Searched: ${DEFAULT_PRD_FILES.join(', ')}`,
				ERROR_CODES.FILE_NOT_FOUND
			);
		}
		return found;
	}

	/**
	 * What a parse would read and write, without an AI call: the PRD (as
	 * resolvePrdPath finds it), the tag, and how many tasks the tag has now
	 */
	async target(
		input: Pick<ParsePrdInput, 'prdPath' | 'tag'> = {}
	): Promise<{ prdPath: string; tag: string; taskCount: number }> {
		const prdPath = this.resolvePrdPath(input.prdPath);
		const tag = input.tag || this.configManager.getActiveTag();
		return { prdPath, tag, taskCount: (await this.readTag(tag)).tasks.length };
	}

	/** Ask the model which gaps in the PRD would change the tasks */
	async findGaps(
		input: PrdInput = {},
		hooks: PrdLogHooks = {}
	): Promise<PrdGapsResult> {
		const aiConfig = new AiConfig(this.configManager, reportTo(hooks));
		try {
			return await this.askForGaps(input, aiConfig);
		} catch (error) {
			if (aiConfig.debug) hooks.onDebug?.(inspect(error));
			throw error;
		}
	}

	private async askForGaps(
		input: PrdInput,
		aiConfig: AiConfig
	): Promise<PrdGapsResult> {
		const prdPath = this.resolvePrdPath(input.prdPath);
		const prdContent = fs.readFileSync(prdPath, 'utf8');
		const { systemPrompt, userPrompt } = getPromptManager().loadPrompt(
			'parse-prd-clarify',
			{
				prdContent: neutralizeTag(prdContent, 'prd'),
				maxQuestions: MAX_CLARIFYING_QUESTIONS
			}
		);
		const response = await new AiService(aiConfig.toHost()).generateObject({
			role: input.research ? 'research' : 'main',
			session: input.session,
			projectRoot: this.projectRoot,
			schema: COMMAND_SCHEMAS['parse-prd-clarify'],
			objectName: 'clarifying_questions',
			systemPrompt,
			prompt: userPrompt,
			commandName: 'parse-prd',
			outputType: input.outputType ?? 'cli'
		});
		// generateObject results arrive as either { questions } or { object: { questions } }
		const result = response?.mainResult;
		const raw = Array.isArray(result?.questions)
			? result.questions
			: Array.isArray(result?.object?.questions)
				? result.object.questions
				: null;
		if (!raw) {
			throw new Error('AI service returned unexpected data for the questions');
		}
		return {
			prdPath,
			questions: normalizeClarifyingQuestions(raw, prdContent),
			telemetryData: response.telemetryData ?? null
		};
	}

	async parse(
		input: ParsePrdInput = {},
		hooks: ParsePrdHooks = {}
	): Promise<ParsePrdResult> {
		const aiConfig = new AiConfig(this.configManager, reportTo(hooks));
		try {
			return await this.generate(input, hooks, aiConfig);
		} catch (error) {
			// The whole error (stack, cause), as the legacy command printed it
			if (aiConfig.debug) hooks.onDebug?.(inspect(error));
			throw error;
		}
	}

	private async generate(
		input: ParsePrdInput,
		hooks: ParsePrdHooks,
		aiConfig: AiConfig
	): Promise<ParsePrdResult> {
		const warn = (message: string) => hooks.onWarning?.(message);
		const prdPath = this.resolvePrdPath(input.prdPath);
		const tag = input.tag || this.configManager.getActiveTag();
		const append = input.append === true;
		const force = input.force === true;
		const research = input.research === true;
		const numTasks = this.numTasks(input.numTasks, aiConfig, warn);
		const projectRoot = this.projectRoot;
		const tasksPath = this.tasksPath;

		if (isReservedNewTagName(tag)) {
			throw new TaskGraphError(
				`"${tag}" is a reserved tag name`,
				ERROR_CODES.VALIDATION_ERROR
			);
		}
		const loaded = await this.readTag(tag);
		const { highestId } = readArchivedIdsSync(tasksPath, tag);
		// Overwriting (force) replaces the list, so numbering starts over (above
		// any archived IDs, which stay reserved); only append continues after
		// the existing tasks
		const existingTasks = append ? loaded.tasks : [];
		const nextId = append
			? nextTaskId(
					loaded.tasks.map((t) => t.id || 0),
					highestId
				)
			: highestId + 1;
		if (loaded.tasks.length > 0 && !append && !force) {
			throw new TaskGraphError(
				`Tag '${tag}' already contains ${loaded.tasks.length} tasks. Use --force to overwrite or --append to add to existing tasks.`,
				ERROR_CODES.VALIDATION_ERROR
			);
		}

		// Each task names the PRD section it implements, so the prompt lists
		// the headings it can cite
		const prdContent = fs.readFileSync(prdPath, 'utf8');
		if (!prdContent) {
			throw new Error(`Input file ${prdPath} is empty or could not be read.`);
		}
		const prd = {
			path: prdPathForSource(projectRoot, prdPath),
			sections: parsePrdSections(prdContent)
		};
		// A parse without append replaces the tasks, so it drops other PRDs' hashes
		const snapshot: SnapshotUpdate | undefined =
			prd.sections.length > 0 || !append
				? {
						path: prd.path,
						snapshot: buildPrdSnapshot(prd.sections),
						replace: !append
					}
				: undefined;

		// append sends the AI only the sections added since the last parse.
		// Changed and removed ones are reported; their tasks are left alone
		const prdDelta =
			append && prd.sections.length > 0
				? diffPrdSections(
						prd.sections,
						prd.path,
						existingTasks,
						getPrdSnapshot(loaded.metadata, prd.path)
					)
				: null;
		const deltaOnly = Boolean(prdDelta?.known);
		if (deltaOnly) hooks.onPrdDelta?.(prdDelta as PrdDelta);
		const done = (
			added: number,
			total: number,
			extra: Partial<ParsePrdResult> = {}
		): ParsePrdResult => ({
			tag,
			prdPath,
			tasksPath,
			added,
			total,
			prdDelta,
			telemetryData: null,
			tagInfo: null,
			estimatedInputTokens: 0,
			...extra
		});
		if (deltaOnly && prdDelta?.added.length === 0) {
			// Nothing new: no AI call and no new tasks. Record the PRD as it is
			// now, so a change or removal is reported once
			if (hasPrdChanges(prdDelta)) await this.save(tag, snapshot, null);
			return done(0, loaded.tasks.length);
		}

		// A count meant for the whole PRD doesn't fit a few new sections, so
		// for those the model decides how many tasks they need
		const promptNumTasks = deltaOnly ? 0 : numTasks;
		const promptSections = deltaOnly
			? (prdDelta as PrdDelta).added
			: prd.sections;
		const prompts = getPromptManager().loadPrompt('parse-prd', {
			research,
			numTasks: promptNumTasks,
			newSectionsOnly: deltaOnly,
			nextId,
			prdContent: neutralizeTag(
				deltaOnly
					? prdDeltaContent(prdDelta as PrdDelta, prdContent)
					: prdContent,
				'prd'
			),
			prdPath,
			// 'prd' also covers the <prd_sections> fence the headings go in
			prdSections: promptSections.length
				? neutralizeTag(formatPrdSectionList(promptSections), 'prd')
				: '',
			// 'existing_tasks' for this fence; 'prd' also covers <prd> and <prd_sections>
			existingTasks: existingTasks.length
				? neutralizeTag(
						neutralizeTag(
							formatExistingTaskList(existingTasks),
							'existing_tasks'
						),
						'prd'
					)
				: '',
			hasCodebaseAnalysis: aiConfig.hasCodebaseAnalysis(
				research,
				input.session
			),
			projectRoot: projectRoot || ''
		});

		const { tasks: generated, response } = await generatePrdTasks({
			ai: new AiService(aiConfig.toHost()),
			aiConfig,
			params: parsePrdServiceParams(prompts, {
				research,
				session: input.session,
				projectRoot,
				outputType: input.outputType ?? 'cli'
			}),
			numTasks: promptNumTasks,
			startId: nextId,
			streaming: input.stream === true,
			hooks,
			debug: (message) => {
				if (aiConfig.debug) hooks.onDebug?.(message);
			}
		});

		// An empty reply would replace the tag's tasks with none and record the
		// PRD as parsed; with append it only adds nothing
		if (generated.length === 0 && !append) {
			throw new Error('The AI returned no tasks; nothing was saved');
		}

		const defaultPriority = aiConfig.defaultPriority || 'medium';
		const saved = await this.save(tag, snapshot, (current) => {
			// A plain parse was allowed because the tag was empty; tasks added
			// since then are replaced only with force
			if (!append && !force && current.length > 0) {
				throw new TaskGraphError(
					`Tasks were added to tag '${stripTerminalControls(String(tag), { singleLine: true })}' while the PRD was being parsed. Run again with --append to add to them or --force to replace them`,
					ERROR_CODES.VALIDATION_ERROR
				);
			}
			const kept = append ? current : [];
			const keptIds = kept.map((t) => t.id);
			const archived = readArchivedIdsSync(tasksPath, tag);
			const added = prepareGeneratedTasks(generated, {
				startId: nextTaskId(keptIds, archived.highestId),
				// A dependency on a task archived while the model ran still names a real task
				existingIds: append ? [...keptIds, ...archived.ids] : [],
				defaultPriority,
				prd,
				promptStartId: nextId
			});
			return [...kept, ...added];
		});

		return done(generated.length, saved.length, {
			telemetryData: response.telemetryData,
			tagInfo: response.tagInfo,
			estimatedInputTokens: estimateTokens(
				prompts.systemPrompt + prompts.userPrompt
			)
		});
	}

	/** numTasks as a count; anything but 0 or more falls back to the default, with a warning */
	private numTasks(
		value: ParsePrdInput['numTasks'],
		aiConfig: AiConfig,
		warn: (message: string) => void
	): number {
		const fallback = aiConfig.defaultNumTasks;
		if (value === undefined || value === null || String(value) === '') {
			return fallback;
		}
		const count = typeof value === 'number' ? value : parseInt(value, 10);
		if (Number.isNaN(count) || count < 0) {
			warn(`Invalid numTasks value: ${value}. Using default: ${fallback}`);
			return fallback;
		}
		return count;
	}

	/**
	 * The tag's tasks and metadata, read without the lock. A missing or empty
	 * tasks.json has none; one that doesn't parse throws (treating it as
	 * empty would skip the overwrite check)
	 */
	private async readTag(
		tag: string
	): Promise<{ tasks: Task[]; metadata: Record<string, unknown> | null }> {
		const file = this.tasksPath;
		if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8').trim() === '') {
			return { tasks: [], metadata: null };
		}
		await this.taskService.initialize();
		const storage = this.taskService.getStorage();
		// Storage reads a missing master as the first tag; that one isn't this tag
		if (!(await storage.getAllTags()).includes(tag)) {
			return { tasks: [], metadata: null };
		}
		return {
			tasks: await storage.loadTasks(tag),
			metadata: (await storage.loadMetadata(tag)) as Record<
				string,
				unknown
			> | null
		};
	}

	/**
	 * Save the tag under the tasks.json lock: `change` gets its tasks as the
	 * file has them now and returns the tasks to save (null keeps them; only
	 * the metadata changes). The tag is created if it doesn't exist.
	 */
	private async save(
		tag: string,
		snapshot: SnapshotUpdate | undefined,
		change: ((current: Task[]) => Task[]) | null
	): Promise<Task[]> {
		await this.taskService.initialize();
		return this.taskService.getStorage().mutateTags((tags, metadata) => {
			const current = tags.get(tag) ?? [];
			const tasks = change ? change(current) : current;
			tags.set(tag, tasks);
			const kept = metadata.get(tag) ?? {};
			const now = new Date().toISOString();
			metadata.set(tag, {
				...kept,
				created: kept.created || now,
				updated: now,
				// A description set with `tags` is kept
				description: kept.description || `Tasks for ${tag} context`,
				...(snapshot
					? {
							[PRD_SNAPSHOT_KEY]: withPrdSnapshot(
								snapshot.replace ? {} : kept,
								snapshot.path,
								snapshot.snapshot
							)
						}
					: {})
			});
			return { changed: [tag], result: tasks };
		});
	}
}
