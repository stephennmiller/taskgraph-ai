/**
 * @fileoverview The dependencies a new task gets: the ones the user asked for,
 * plus any the AI suggested, checked against the tasks of the tag the task
 * goes in. Task IDs are unique only within a tag, so callers pass that tag's
 * task IDs, never every tag's.
 */

type DependencyId = string | number;

export interface MergeNewTaskDependenciesOptions {
	/** IDs the user asked for; always kept when they exist */
	explicit: readonly DependencyId[];
	/** IDs the AI suggested; added after the explicit ones */
	suggested?: readonly DependencyId[] | null;
	/** IDs of the tasks in the tag the new task is added to */
	existingIds: readonly DependencyId[];
}

export interface NewTaskDependencies {
	/** Explicit IDs first, then new suggestions, each once, as given */
	dependencies: DependencyId[];
	/** Explicit IDs with no task in the tag */
	missingExplicit: DependencyId[];
	/** Suggested IDs with no task in the tag */
	missingSuggested: DependencyId[];
}

/**
 * Merge the dependencies the user asked for with the ones the AI suggested.
 * An ID is compared as a string, so `1` and `"1"` are the same task.
 */
export function mergeNewTaskDependencies({
	explicit,
	suggested,
	existingIds
}: MergeNewTaskDependenciesOptions): NewTaskDependencies {
	const known = new Set(existingIds.map(String));
	const seen = new Set<string>();
	const result: NewTaskDependencies = {
		dependencies: [],
		missingExplicit: [],
		missingSuggested: []
	};

	const take = (ids: readonly DependencyId[], missing: DependencyId[]) => {
		for (const id of ids) {
			const key = String(id);
			if (seen.has(key)) continue;
			seen.add(key);
			if (known.has(key)) {
				result.dependencies.push(id);
			} else {
				missing.push(id);
			}
		}
	};

	take(explicit, result.missingExplicit);
	take(suggested ?? [], result.missingSuggested);
	return result;
}
