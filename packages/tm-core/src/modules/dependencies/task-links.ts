/**
 * @fileoverview Typed links between tasks: `blocks`, `related` and
 * `discovered-from`.
 *
 * Only `blocks` holds a task back. A blocking link is a plain dependency in
 * `dependencies[]`, with its provenance in `metadata.dependencySources`
 * (see dependency-provenance.ts); having no link type there means `blocks`, so
 * every existing file loads unchanged.
 *
 * Decision: non-blocking links live outside `dependencies[]`, in the reserved
 * metadata key `taskLinks` (`{ "5": "related", "3": "discovered-from" }`).
 * Every consumer of `dependencies[]` (next, why, blocked counts, the critical
 * path, loop checks, validate/fix-dependencies, the legacy scripts and the MCP
 * tools) treats each entry as a blocker. Keeping non-blocking links in that
 * array would need a filter in each of them, and one missed filter would let
 * a "related" link block work. Kept apart, none of that code can see them.
 * `metadata` already survives every storage operation and AI rewrite, which
 * is why provenance lives there too.
 *
 * Keys are full IDs ("5", or "2.1" for a subtask) whether the link sits on a
 * task or a subtask, so they read the same anywhere and need no re-keying
 * when the task holding them moves. A target that is also listed in
 * `dependencies` is a blocker: the dependency wins and the link is ignored.
 */

import { isDeepStrictEqual } from 'node:util';
import { fullSubtaskId } from '../tasks/validation/task-id.js';
import {
	TASK_LINKS_KEY,
	assignMetadata,
	hasDependency
} from './dependency-provenance.js';

/** How one task relates to another; only `blocks` holds it back */
export type LinkType = 'blocks' | 'related' | 'discovered-from';

/** The link types stored in `metadata.taskLinks` */
export type NonBlockingLinkType = Exclude<LinkType, 'blocks'>;

export const LINK_TYPES: readonly LinkType[] = [
	'blocks',
	'related',
	'discovered-from'
];

export interface TaskLink {
	/** Full ID of the linked task: "5", or "2.1" for a subtask */
	id: string;
	type: NonBlockingLinkType;
}

type DependencyId = string | number;
type Metadata = Record<string, unknown>;

interface Linkable {
	id?: DependencyId;
	dependencies?: DependencyId[];
	metadata?: Metadata;
}

interface LinkableTask extends Linkable {
	subtasks?: Linkable[];
}

const NON_BLOCKING: readonly string[] = ['related', 'discovered-from'];

const isNonBlocking = (value: unknown): value is NonBlockingLinkType =>
	typeof value === 'string' && NON_BLOCKING.includes(value);

/**
 * A full task or subtask ID ("5", "2.1"). Keys come from a hand-editable
 * file, so anything else (`__proto__`, terminal escape codes, junk) is
 * ignored rather than shown or kept.
 */
const FULL_ID = /^\d+(\.\d+)?$/;

/**
 * The link type a user typed, or undefined when it isn't one. No value
 * means `blocks`, today's behavior.
 */
export function parseLinkType(value: unknown): LinkType | undefined {
	if (value === undefined || value === null || value === '') return 'blocks';
	if (typeof value !== 'string') return undefined;
	const type = value.trim().toLowerCase();
	return (LINK_TYPES as readonly string[]).includes(type)
		? (type as LinkType)
		: undefined;
}

/** Stored links, keyed by full ID; anything malformed is skipped */
function readLinks(
	metadata: Metadata | undefined
): Record<string, NonBlockingLinkType> {
	const stored = metadata?.[TASK_LINKS_KEY];
	if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
		return {};
	}
	const links: Record<string, NonBlockingLinkType> = {};
	for (const [id, type] of Object.entries(stored)) {
		if (FULL_ID.test(id) && isNonBlocking(type)) links[id] = type;
	}
	return links;
}

/** A copy of metadata holding `links`; undefined when nothing is left */
function withLinks(
	metadata: Metadata | undefined,
	links: Record<string, NonBlockingLinkType>
): Metadata | undefined {
	const { [TASK_LINKS_KEY]: _old, ...rest } = metadata ?? {};
	if (Object.keys(links).length > 0) rest[TASK_LINKS_KEY] = links;
	return Object.keys(rest).length > 0 ? rest : undefined;
}

const compareIds = (a: string, b: string): number =>
	a.localeCompare(b, undefined, { numeric: true });

/**
 * A task's non-blocking links, ordered by type (related first) then ID.
 * Targets the task also depends on are left out: the dependency wins.
 *
 * @param parentId - The parent's ID when `task` is a subtask, so its stored
 *   dependencies resolve (a bare number is a sibling)
 */
export function getTaskLinks(
	task: Linkable,
	parentId?: DependencyId
): TaskLink[] {
	return Object.entries(readLinks(task.metadata))
		.filter(([id]) => !hasDependency(task, id, parentId))
		.map(([id, type]) => ({ id, type }))
		.sort(
			(a, b) =>
				NON_BLOCKING.indexOf(a.type) - NON_BLOCKING.indexOf(b.type) ||
				compareIds(a.id, b.id)
		);
}

/**
 * How `task` is linked to `targetId`: `blocks` when it depends on it, the
 * stored type for a non-blocking link, undefined when they aren't linked.
 */
export function getLinkType(
	task: Linkable,
	targetId: DependencyId,
	parentId?: DependencyId
): LinkType | undefined {
	if (hasDependency(task, targetId, parentId)) return 'blocks';
	const links = readLinks(task.metadata);
	const key = String(targetId);
	// Own keys only: "constructor" must not find Object.prototype's
	return Object.hasOwn(links, key) ? links[key] : undefined;
}

/** Metadata with a non-blocking link to `targetId` (replacing any other type) */
export function setTaskLink(
	metadata: Metadata | undefined,
	targetId: DependencyId,
	type: NonBlockingLinkType
): Metadata | undefined {
	const links = readLinks(metadata);
	links[String(targetId)] = type;
	return withLinks(metadata, links);
}

/** Metadata without a link to `targetId` */
export function removeTaskLink(
	metadata: Metadata | undefined,
	targetId: DependencyId
): Metadata | undefined {
	const links = readLinks(metadata);
	delete links[String(targetId)];
	return withLinks(metadata, links);
}

/** Every task and subtask with its full ID */
function* everyItem(
	tasks: LinkableTask[]
): Generator<{ item: Linkable; fullId: string }> {
	for (const task of tasks) {
		const taskId = String(task.id);
		yield { item: task, fullId: taskId };
		for (const subtask of task.subtasks ?? []) {
			yield {
				item: subtask,
				fullId: fullSubtaskId(taskId, String(subtask.id))
			};
		}
	}
}

/**
 * Rewrite each item's link keys; only items whose stored links change are
 * touched. Malformed entries (see readLinks) are dropped along the way.
 */
function rewriteLinks(
	tasks: LinkableTask[],
	rewrite: (
		links: Record<string, NonBlockingLinkType>,
		fullId: string
	) => Record<string, NonBlockingLinkType>
): void {
	for (const { item, fullId } of everyItem(tasks)) {
		const stored = item.metadata?.[TASK_LINKS_KEY];
		if (stored === undefined) continue;
		const next = rewrite(readLinks(item.metadata), fullId);
		if (!isDeepStrictEqual(stored, next)) {
			assignMetadata(item, withLinks(item.metadata, next));
		}
	}
}

/**
 * A task or subtask changed ID (a move): point every link to `oldId` at
 * `newId`, on every task and subtask. With `withSubtasks`, links to the old
 * task's subtasks ("8.2") follow it too ("9.2"), for a task that keeps its
 * subtasks under the new ID.
 */
export function retargetTaskLinks(
	tasks: LinkableTask[],
	oldId: DependencyId,
	newId: DependencyId,
	{ withSubtasks = false }: { withSubtasks?: boolean } = {}
): void {
	const from = String(oldId);
	const to = String(newId);
	const renamed = (key: string): string => {
		if (key === from) return to;
		if (withSubtasks && key.startsWith(`${from}.`)) {
			return `${to}${key.slice(from.length)}`;
		}
		return key;
	};
	rewriteLinks(tasks, (links, fullId) => {
		const next: Record<string, NonBlockingLinkType> = {};
		for (const [key, type] of Object.entries(links)) {
			const target = renamed(key);
			// A link that now names its own task means nothing
			if (target !== fullId) next[target] = type;
		}
		return next;
	});
}

/** A non-blocking link whose target isn't among the tasks */
export interface DanglingLink {
	/** Full ID of the task or subtask holding the link */
	taskId: string;
	/** Full ID it points at */
	linkedId: string;
	type: NonBlockingLinkType;
}

/** Full IDs of every task and subtask */
function allIds(tasks: LinkableTask[]): Set<string> {
	return new Set([...everyItem(tasks)].map(({ fullId }) => fullId));
}

/**
 * Links that point at a task or subtask that doesn't exist (any longer), or
 * at the task holding them.
 *
 * @param exists - Which IDs count as existing; defaults to `tasks` itself
 */
export function findDanglingLinks(
	tasks: LinkableTask[],
	exists: (id: string) => boolean = (
		(ids) => (id: string) =>
			ids.has(id)
	)(allIds(tasks))
): DanglingLink[] {
	const dangling: DanglingLink[] = [];
	for (const { item, fullId } of everyItem(tasks)) {
		for (const [linkedId, type] of Object.entries(readLinks(item.metadata))) {
			if (linkedId === fullId || !exists(linkedId)) {
				dangling.push({ taskId: fullId, linkedId, type });
			}
		}
	}
	return dangling;
}

/**
 * Drop links to tasks that don't exist, as removing a task drops the
 * dependencies on it, and any malformed entry. Returns the dropped links
 * (malformed entries aren't listed: they never named a task).
 *
 * @param exists - Which IDs count as existing; defaults to `tasks` itself.
 *   A move to another tag passes the moved IDs, since a link must not point
 *   at whatever has the same ID in the new tag.
 */
export function pruneTaskLinks(
	tasks: LinkableTask[],
	exists?: (id: string) => boolean
): DanglingLink[] {
	const dangling = findDanglingLinks(tasks, exists);
	// Runs even with nothing dangling, so malformed entries are dropped too
	const drop = new Set(dangling.map((d) => `${d.taskId}\u0000${d.linkedId}`));
	rewriteLinks(tasks, (links, fullId) =>
		Object.fromEntries(
			Object.entries(links).filter(
				([key]) => !drop.has(`${fullId}\u0000${key}`)
			)
		)
	);
	return dangling;
}
