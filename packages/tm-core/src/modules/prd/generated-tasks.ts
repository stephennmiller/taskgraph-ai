/**
 * @fileoverview IDs and dependencies for the tasks parse-prd generates.
 */

/** A task as the model returned it: its own ID and the IDs it depends on */
export interface GeneratedTaskIds {
	id: number;
	dependencies?: unknown;
}

export interface NumberGeneratedTasksOptions {
	/** The first ID the prompt told the model to use */
	promptStartId: number;
	/**
	 * The first ID the new tasks get. Above promptStartId when tasks were
	 * added to the tag while the model ran
	 */
	startId: number;
	/** IDs of the tasks in the tag now */
	existingIds: Iterable<string | number>;
}

/**
 * Final IDs and dependencies for generated tasks. The tasks are numbered
 * from `startId` in the order the model returned them. A dependency below
 * `promptStartId` that names a task in the tag stays as it is: the prompt
 * offered those as existing tasks, and renumbering the new tasks doesn't move
 * them. A model that numbered from 1 instead means its own tasks by every ID.
 * Any other dependency names a generated task and follows it to its new ID.
 * A dependency on nothing, or on a task that isn't lower, is dropped.
 */
export function numberGeneratedTasks(
	tasks: GeneratedTaskIds[],
	options: NumberGeneratedTasksOptions
): Array<{ id: number; dependencies: number[] }> {
	const { promptStartId, startId } = options;
	const existing = new Set(Array.from(options.existingIds, String));
	const numberedFromPrompt = tasks[0]?.id === promptStartId;
	const newIds = new Map(
		tasks.map((task, index) => [task.id, startId + index])
	);

	return tasks.map((task, index) => {
		const id = startId + index;
		const dependencies = new Set<number>();
		for (const dep of Array.isArray(task.dependencies)
			? task.dependencies
			: []) {
			const target =
				numberedFromPrompt &&
				typeof dep === 'number' &&
				dep < promptStartId &&
				existing.has(String(dep))
					? dep
					: newIds.get(dep as number);
			if (target !== undefined && target < id) dependencies.add(target);
		}
		return { id, dependencies: [...dependencies] };
	});
}

/**
 * The tag's tasks for the parse-prd prompt when appending, one per line
 * (`- 3: Set up auth`), so the model can depend on real ones. Only the
 * `limit` highest IDs are listed.
 * shortcut: only the newest tasks, to bound the prompt; rank by relevance if
 * models miss older ones
 */
export function formatExistingTaskList(
	tasks: Array<{ id: string | number; title?: string }>,
	limit = 100
): string {
	const sorted = [...tasks].sort((a, b) => Number(a.id) - Number(b.id));
	const shown = sorted.slice(-limit);
	const lines = shown.map(
		(task) => `- ${task.id}: ${(task.title ?? '').replace(/\s+/g, ' ').trim()}`
	);
	const hidden = sorted.length - shown.length;
	if (hidden > 0) lines.push(`(${hidden} earlier tasks not listed)`);
	return lines.join('\n');
}
