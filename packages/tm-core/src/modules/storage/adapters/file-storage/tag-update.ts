/**
 * @fileoverview Pure helpers that build the tasks.json contents for one tag
 */

import type { MutateTags } from '../../../../common/interfaces/storage.interface.js';
import type { Task, TaskMetadata } from '../../../../common/types/index.js';
import type { FormatHandler } from './format-handler.js';
import { getOwnKey, setOwnKey } from '../../../../common/utils/own-key.js';
import { withSchemaVersion } from './schema-version.js';

export function buildTagMetadata(tasks: Task[], tag: string): TaskMetadata {
	return {
		version: '1.0.0',
		lastModified: new Date().toISOString(),
		taskCount: tasks.length,
		completedCount: tasks.filter((t) => t.status === 'done').length,
		tags: [tag]
	};
}

/**
 * The tag's new metadata over what it had, so keys other writers keep there
 * (`created`, `description`, parse-prd's `prdSections`) survive a save
 */
function mergeTagMetadata(
	metadata: TaskMetadata,
	existing: TaskMetadata | null | undefined
): TaskMetadata & { schemaVersion: number } {
	const kept = existing && typeof existing === 'object' ? existing : {};
	return withSchemaVersion({ ...kept, ...metadata }, existing);
}

/** Put `tasks` under `resolvedTag` in the parsed file contents */
export function applyTagUpdate(
	formatHandler: FormatHandler,
	existingData: any,
	resolvedTag: string,
	tasks: Task[],
	metadata: TaskMetadata
): any {
	const normalizedTasks = normalizeTaskIds(tasks);

	if (
		formatHandler.detectFormat(existingData) === 'legacy' ||
		Object.keys(existingData).some(
			(key) => key !== 'tasks' && key !== 'metadata'
		)
	) {
		// Legacy format - update/add the tag
		setOwnKey(existingData, resolvedTag, {
			tasks: normalizedTasks,
			metadata: mergeTagMetadata(
				metadata,
				getOwnKey(existingData, resolvedTag)?.metadata
			)
		});
		return existingData;
	}
	if (resolvedTag === 'master') {
		// Standard format for master tag
		return {
			tasks: normalizedTasks,
			metadata: mergeTagMetadata(metadata, existingData.metadata)
		};
	}
	// Convert to legacy format when adding non-master tags
	const masterTasks = existingData.tasks || [];
	const masterMetadata = existingData.metadata || metadata;

	return {
		master: {
			tasks: masterTasks,
			metadata: withSchemaVersion(masterMetadata, existingData.metadata)
		},
		[resolvedTag]: {
			tasks: normalizedTasks,
			metadata: withSchemaVersion(metadata)
		}
	};
}

/**
 * Normalize task IDs - keep Task IDs as strings, Subtask IDs as numbers
 * Note: Uses spread operator to preserve all task properties including user-defined metadata
 */
function normalizeTaskIds(tasks: Task[]): Task[] {
	return tasks.map((task) => ({
		...task,
		id: String(task.id), // Task IDs are strings
		dependencies: task.dependencies?.map((dep) => String(dep)) || [],
		subtasks:
			task.subtasks?.map((subtask) => ({
				...subtask,
				id: Number(subtask.id), // Subtask IDs are numbers
				parentId: String(subtask.parentId ?? task.id) // Parent ID is string (Task ID); older files omit it
			})) || []
	}));
}

/**
 * Run a MutateTags change on the parsed file contents: it gets every tag's
 * tasks (a file without tags has only master) and the tags it names are
 * written back
 */
export async function mutateTagsIn<R>(
	formatHandler: FormatHandler,
	data: any,
	mutate: MutateTags<R>
): Promise<{ data: any; result: R }> {
	const names =
		formatHandler.detectFormat(data) === 'legacy'
			? formatHandler.extractTags(data)
			: ['master'];
	const tags = new Map(
		names.map((tag) => [tag, formatHandler.extractTasks(data, tag)])
	);
	const metadata = new Map<string, Record<string, unknown>>(
		names.map((tag) => [tag, { ...formatHandler.extractMetadata(data, tag) }])
	);
	const { changed, result } = await mutate(tags, metadata);
	for (const tag of new Set(changed)) {
		// A missing or empty file starts tagged, as the legacy writers create it
		if (!data || Object.keys(data).length === 0) {
			data = {};
			setOwnKey(data, tag, { tasks: [], metadata: {} });
		}
		const tasks = tags.get(tag) ?? [];
		data = applyTagUpdate(formatHandler, data, tag, tasks, {
			...metadata.get(tag),
			...buildTagMetadata(tasks, tag)
		} as TaskMetadata);
	}
	return { data, result };
}
