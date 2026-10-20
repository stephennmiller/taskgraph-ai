/**
 * @fileoverview Marks each task dependency as explicit (user-stated) or
 * inferred (invented by the AI in parse-prd, add-task, expand or update).
 *
 * Decision: provenance lives in `Task.metadata.dependencySources` rather than
 * a new typed field. `dependencies` is a plain ID array, so provenance is a
 * sidecar map keyed by dependency ID. `metadata` is already carried through
 * every task operation (storage CRUD, AI rewrites, move/expand in the legacy
 * scripts), whereas a new top-level field would be dropped by each of those
 * rewrites until it was threaded through them one by one. Only `inferred`
 * entries are stored; a dependency with no entry is explicit, so existing
 * files and manually added dependencies need no migration. Readers go through
 * getDependencySource, which ignores entries for dependencies no longer listed.
 *
 * AI dependency creation currently runs in the legacy scripts/modules
 * task-manager, not in @tm/core, so those call sites use these helpers.
 */

export type DependencySource = 'explicit' | 'inferred';

export const DEPENDENCY_SOURCES_KEY = 'dependencySources';

type DependencyId = string | number;
type Metadata = Record<string, unknown>;

interface WithDependencies {
	dependencies?: DependencyId[];
	metadata?: Metadata;
}

function readInferred(metadata: Metadata | undefined): Record<string, string> {
	const stored = metadata?.[DEPENDENCY_SOURCES_KEY];
	if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
		return {};
	}
	return stored as Record<string, string>;
}

function isListed(task: WithDependencies, depId: DependencyId): boolean {
	return (task.dependencies ?? []).some((d) => String(d) === String(depId));
}

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

/** Source of one dependency; anything not recorded as inferred is explicit. */
export function getDependencySource(
	task: WithDependencies,
	depId: DependencyId
): DependencySource {
	if (!isListed(task, depId)) return 'explicit';
	return readInferred(task.metadata)[String(depId)] === 'inferred'
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
	previous?: WithDependencies
): Metadata | undefined {
	const priorInferred = readInferred(previous?.metadata);
	const inferred: Record<string, string> = {};

	for (const dep of current.dependencies ?? []) {
		const key = String(dep);
		const existed = previous ? isListed(previous, dep) : false;
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
	source: DependencySource
): Metadata | undefined {
	const inferred = { ...readInferred(metadata) };
	if (source === 'inferred') {
		inferred[String(depId)] = 'inferred';
	} else {
		delete inferred[String(depId)];
	}
	return withInferred(metadata, inferred);
}

/** Carry a mark across a dependency ID change (e.g. a task move). */
export function renameDependencySource(
	metadata: Metadata | undefined,
	oldId: DependencyId,
	newId: DependencyId
): Metadata | undefined {
	const inferred = { ...readInferred(metadata) };
	const oldKey = String(oldId);
	if (inferred[oldKey] !== 'inferred') return metadata;
	delete inferred[oldKey];
	inferred[String(newId)] = 'inferred';
	return withInferred(metadata, inferred);
}
