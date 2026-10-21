/**
 * @fileoverview Marks each task dependency as explicit (user-stated) or
 * inferred (invented by the AI in parse-prd, add-task, expand or update).
 *
 * Decision: provenance lives in `Task.metadata.dependencySources` rather than
 * a new typed field. `dependencies` is a plain ID array, so provenance is a
 * sidecar map keyed by dependency ID. `metadata` is already carried through
 * every storage operation and the legacy AI rewrite paths, whereas a new
 * top-level field would be dropped by each rewrite until it was threaded
 * through. Only `inferred` entries are stored; a dependency with no entry is
 * explicit, so existing files and manually added dependencies need no
 * migration. `dependencySources` is a reserved metadata key.
 *
 * Keys are canonical full IDs: a task's keys are its plain IDs ("5"); a
 * subtask's sibling keys are dotted ("2.1") whether the dependency is stored
 * as 1 or "2.1", and a task it depends on keeps its plain key ("3", stored
 * as "3"). Pass the subtask's parent ID as `parentId` and every function
 * resolves stored dependencies with `resolveSubtaskDependency`, the rule the
 * rest of the code uses: a number below 100 is a sibling, a string without a
 * dot is a task. Keys are already full IDs and are read as they are.
 *
 * Readers go through getDependencySource, which ignores entries for
 * dependencies no longer listed, and writers prune marks when a dependency is
 * removed so a later re-add cannot inherit a stale one.
 *
 * Where the AI invents dependencies, and all of them record it: parse-prd,
 * add-task, expand-task, update-task, update and scope-up/scope-down
 * (regenerated subtasks), all in the legacy scripts/modules/task-manager. A
 * dependency the user asked for in an update prompt is still recorded as
 * inferred, because the model decides which IDs to write. The other AI
 * commands (research, analyze-complexity, update-subtask) never write
 * dependencies.
 */

import { resolveSubtaskDependency } from './subtask-dependency.js';

export type DependencySource = 'explicit' | 'inferred';

export const DEPENDENCY_SOURCES_KEY = 'dependencySources';

type DependencyId = string | number;
type Metadata = Record<string, unknown>;

interface WithDependencies {
	dependencies?: DependencyId[];
	metadata?: Metadata;
}

/**
 * Canonical key for a dependency stored on a task (no parent) or on a subtask
 * of `parentId`, where a bare number below 100 is a sibling.
 */
function canonical(id: DependencyId, parentId?: DependencyId): string {
	return parentId === undefined
		? String(id)
		: resolveSubtaskDependency(parentId, id);
}

/** Inferred marks, keyed by full ID as written. */
function readInferred(metadata: Metadata | undefined): Record<string, string> {
	const stored = metadata?.[DEPENDENCY_SOURCES_KEY];
	if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
		return {};
	}
	return { ...(stored as Record<string, string>) };
}

/** Whether the task lists this dependency, in either stored form. */
export function hasDependency(
	task: WithDependencies,
	depId: DependencyId,
	parentId?: DependencyId
): boolean {
	const key = canonical(depId, parentId);
	return (task.dependencies ?? []).some((d) => canonical(d, parentId) === key);
}

const isListed = hasDependency;

/**
 * Write the inferred set into a copy of metadata. Drops the key when empty;
 * returns undefined when no metadata remains at all.
 */
function withInferred(
	metadata: Metadata | undefined,
	inferred: Record<string, string>
): Metadata | undefined {
	const { [DEPENDENCY_SOURCES_KEY]: _old, ...rest } = metadata ?? {};
	if (Object.keys(inferred).length > 0) {
		rest[DEPENDENCY_SOURCES_KEY] = inferred;
	}
	return Object.keys(rest).length > 0 ? rest : undefined;
}

/**
 * User-supplied metadata (update-task / update-subtask --metadata) without the
 * reserved provenance key, so callers can't overwrite it by accident.
 * Returns undefined when nothing else is left.
 */
export function withoutReservedMetadata(
	metadata: Metadata | null | undefined
): Metadata | undefined {
	if (!metadata) return undefined;
	const { [DEPENDENCY_SOURCES_KEY]: _reserved, ...rest } = metadata;
	return Object.keys(rest).length > 0 ? rest : undefined;
}

/** Set a task's metadata, or delete the field when there is none. */
export function assignMetadata(
	task: { metadata?: Metadata },
	metadata: Metadata | undefined
): void {
	if (metadata) task.metadata = metadata;
	else delete task.metadata;
}

/** Source of one dependency; anything not recorded as inferred is explicit. */
export function getDependencySource(
	task: WithDependencies,
	depId: DependencyId,
	parentId?: DependencyId
): DependencySource {
	if (!isListed(task, depId, parentId)) return 'explicit';
	return readInferred(task.metadata)[canonical(depId, parentId)] === 'inferred'
		? 'inferred'
		: 'explicit';
}

/**
 * Metadata for a task whose dependencies were just produced by the AI.
 * Dependencies already present in `previous` keep their earlier source; new
 * ones are marked inferred; entries for removed dependencies are dropped.
 * Returns the full metadata to assign (undefined when it would be empty).
 */
export function reconcileDependencySources(
	current: WithDependencies,
	previous?: WithDependencies,
	parentId?: DependencyId
): Metadata | undefined {
	const priorInferred = readInferred(previous?.metadata);
	const inferred: Record<string, string> = {};

	for (const dep of current.dependencies ?? []) {
		const key = canonical(dep, parentId);
		const existed = previous ? isListed(previous, dep, parentId) : false;
		if (!existed || priorInferred[key] === 'inferred') {
			inferred[key] = 'inferred';
		}
	}

	return withInferred(previous?.metadata ?? current.metadata, inferred);
}

/** Record one dependency's source (explicit clears any inferred mark). */
export function setDependencySource(
	metadata: Metadata | undefined,
	depId: DependencyId,
	source: DependencySource,
	parentId?: DependencyId
): Metadata | undefined {
	const inferred = readInferred(metadata);
	const key = canonical(depId, parentId);
	if (source === 'inferred') inferred[key] = 'inferred';
	else delete inferred[key];
	return withInferred(metadata, inferred);
}

/** Drop marks for dependencies the task no longer lists. */
export function pruneDependencySources(
	task: WithDependencies,
	parentId?: DependencyId
): Metadata | undefined {
	const kept: Record<string, string> = {};
	for (const [key, value] of Object.entries(readInferred(task.metadata))) {
		if (isListed(task, key, parentId)) kept[key] = value;
	}
	return withInferred(task.metadata, kept);
}

/**
 * A dependency changed ID (a task move): the new ID takes the old ID's
 * source, replacing any mark it already had.
 */
export function renameDependencySource(
	metadata: Metadata | undefined,
	oldId: DependencyId,
	newId: DependencyId,
	parentId?: DependencyId
): Metadata | undefined {
	const inferred = readInferred(metadata);
	const source = inferred[canonical(oldId, parentId)];
	delete inferred[canonical(oldId, parentId)];
	delete inferred[canonical(newId, parentId)];
	if (source === 'inferred') inferred[canonical(newId, parentId)] = 'inferred';
	return withInferred(metadata, inferred);
}

/**
 * A task or subtask moved to a different parent (or to top level, with
 * `undefined`) and keeps its stored dependencies, or has them rewritten by
 * `newStoredDependency`. Re-key the marks to the form the new context reads.
 */
export function rekeyDependencySources(
	task: WithDependencies,
	oldParentId: DependencyId | undefined,
	newParentId: DependencyId | undefined,
	newStoredDependency: (dep: DependencyId) => DependencyId = (dep) => dep
): Metadata | undefined {
	const before = readInferred(task.metadata);
	const after: Record<string, string> = {};
	for (const dep of task.dependencies ?? []) {
		if (before[canonical(dep, oldParentId)] === 'inferred') {
			after[canonical(newStoredDependency(dep), newParentId)] = 'inferred';
		}
	}
	return withInferred(task.metadata, after);
}
