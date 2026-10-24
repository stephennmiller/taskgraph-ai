/**
 * @fileoverview The tasks parse-prd gets back from the model: recovering a
 * reply that repeats its JSON, checking the model's IDs, and turning the
 * model's tasks into stored tasks (IDs, dependencies, PRD source, criteria).
 */

import { ParsePrdResponseSchema } from '../../ai/schemas/parse-prd.js';
import {
	assignMetadata,
	reconcileDependencySources
} from '../../dependencies/dependency-provenance.js';
import { numberGeneratedTasks } from '../../prd/generated-tasks.js';
import { prdSourceMetadata } from '../../prd/prd-deltas.js';
import type { PrdSection } from '../../prd/prd-sections.js';
import { setGeneratedCriteria } from './acceptance-criteria.js';

/** A task as the model wrote it (see ParsePrdResponseSchema) */
export interface GeneratedPrdTask {
	id: number;
	title?: string;
	section?: string | null;
	dependencies?: unknown;
	[key: string]: any;
}

/**
 * The first complete top-level JSON object in a string, or null.
 * Strings and escapes are respected, so braces inside values don't count.
 */
export function firstJsonObject(text: unknown): string | null {
	if (typeof text !== 'string') return null;
	const start = text.indexOf('{');
	if (start < 0) return null;
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let i = start; i < text.length; i++) {
		const ch = text[i];
		if (inString) {
			if (escaped) escaped = false;
			else if (ch === '\\') escaped = true;
			else if (ch === '"') inString = false;
		} else if (ch === '"') {
			inString = true;
		} else if (ch === '{') {
			depth++;
		} else if (ch === '}') {
			depth--;
			if (depth === 0) return text.slice(start, i + 1);
		}
	}
	return null;
}

/**
 * Recover the task list from a model reply that failed to parse as a whole.
 * Claude Code sometimes repeats the JSON object, so the reply is two objects
 * back to back; the first is complete. Null unless it matches the schema.
 */
export function recoverTaskList(
	text: unknown
): { tasks: GeneratedPrdTask[] } | null {
	const json = firstJsonObject(text);
	if (!json) return null;
	try {
		const result = ParsePrdResponseSchema.safeParse(JSON.parse(json));
		return result.success ? result.data : null;
	} catch {
		return null;
	}
}

/** The model's IDs must be unique and sequential, from 1 or the ID the prompt gave */
function validateSequentialTaskIds(
	rawTasks: GeneratedPrdTask[],
	expectedStartId = 1
): void {
	if (!Array.isArray(rawTasks) || rawTasks.length === 0) {
		return;
	}

	const ids = rawTasks.map((task) => task.id);

	if (ids.some((id) => !Number.isInteger(id) || id < 1)) {
		throw new Error(
			'PRD tasks must use sequential positive integer IDs starting at 1.'
		);
	}

	const uniqueIds = new Set(ids);
	if (uniqueIds.size !== ids.length) {
		throw new Error(
			'PRD task IDs must be unique and sequential starting at 1.'
		);
	}

	const sortedIds = [...uniqueIds].sort((a, b) => a - b);
	const startId = sortedIds[0];
	if (startId !== 1 && startId !== expectedStartId) {
		throw new Error(
			`PRD task IDs must start at 1 or ${expectedStartId} and be sequential.`
		);
	}

	for (let index = 0; index < sortedIds.length; index += 1) {
		if (sortedIds[index] !== startId + index) {
			throw new Error(
				`PRD task IDs must be a contiguous sequence starting at ${startId}.`
			);
		}
	}
}

export interface PrepareGeneratedTasksOptions {
	/** ID the first new task gets */
	startId: number;
	/** IDs of the tag's tasks now, live or archived; a new task may depend on one */
	existingIds: Array<string | number>;
	/** Used when the model left priority out */
	defaultPriority: string;
	/** The PRD's path and headings; a task naming one of them gets `metadata.source` */
	prd?: { path: string; sections: PrdSection[] };
	/** The first ID the prompt told the model to use; a dependency below it names an existing task */
	promptStartId?: number;
}

/** The model's tasks, numbered from `startId` and ready to store */
export function prepareGeneratedTasks(
	rawTasks: GeneratedPrdTask[],
	options: PrepareGeneratedTasksOptions
): any[] {
	const { startId, existingIds, defaultPriority, prd } = options;
	const promptStartId = options.promptStartId ?? startId;
	// Runtime guard: ensure PRD task IDs are unique and sequential (1..N).
	validateSequentialTaskIds(rawTasks, promptStartId);

	const numbered = numberGeneratedTasks(rawTasks, {
		promptStartId,
		startId,
		existingIds
	});

	return rawTasks.map(({ section, ...task }, index) => {
		// Only a section the PRD has; an invented slug would point nowhere.
		// The section's hash lets a later --append tell whether it changed
		const source = prd
			? prdSourceMetadata(section, prd.sections, prd.path)
			: undefined;

		// The AI's criteria are stored as unchecked items (none: no field)
		const processed = setGeneratedCriteria({
			...task,
			...(source ? { metadata: { ...task.metadata, ...source } } : {}),
			...numbered[index],
			status: task.status || 'pending',
			priority: task.priority || defaultPriority,
			subtasks: task.subtasks || [],
			// Ensure all required fields have values
			title: task.title || '',
			description: task.description || '',
			details: task.details || '',
			testStrategy: task.testStrategy || ''
		});
		// The AI invented these dependencies, so record them as inferred
		assignMetadata(processed, reconcileDependencySources(processed));
		return processed;
	});
}
