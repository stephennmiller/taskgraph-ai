/**
 * @fileoverview What changed in a PRD since tasks were made from it, so
 * `parse-prd --append` sends the AI only the sections that are new.
 *
 * Every parse records a hash of each section's own text twice: on each task,
 * as `metadata.sourceHash` next to `metadata.source`, and for the whole PRD in
 * the tag's metadata (`prdSections`), which also remembers the sections that
 * got no task (an overview, non-goals) so they aren't offered again.
 *
 * Comparing the PRD now against those hashes gives three groups:
 *   - new sections: no hash recorded for them, so they get tasks
 *   - changed sections: the text hash differs; their tasks may be stale, but
 *     are left as they are
 *   - removed sections: recorded or cited before, gone from the PRD now
 */

import { createHash } from 'node:crypto';
import {
	type PrdSection,
	formatPrdSource,
	getPrdSource,
	parsePrdSource,
	resolvePrdSection
} from './prd-sections.js';

/** Where a task records the hash of its section's text, next to `source` */
export const PRD_SOURCE_HASH_KEY = 'sourceHash';

/** Where a tag records the section hashes of each PRD it was parsed from */
export const PRD_SNAPSHOT_KEY = 'prdSections';

/** Section hashes by slug, for one PRD */
export type PrdSnapshot = Record<string, string>;

/** Section hashes by PRD path (as tasks cite it), then slug */
export type PrdSnapshots = Record<string, PrdSnapshot>;

export interface PrdDeltaTask {
	id: number | string;
	status?: string;
	metadata?: Record<string, unknown>;
}

export interface PrdDelta {
	/** The PRD, as tasks cite it */
	path: string;
	/** Sections with nothing recorded for them, in document order */
	added: PrdSection[];
	/** Sections whose text changed, with the tasks that cite them */
	changed: Array<{
		slug: string;
		title: string;
		taskIds: Array<number | string>;
	}>;
	/** Sections the PRD no longer has, with the tasks that cite them */
	removed: Array<{ slug: string; taskIds: Array<number | string> }>;
	/** How many sections are as they were */
	unchanged: number;
	/**
	 * Whether anything was known about this PRD before. When nothing was, every
	 * section is new and the whole PRD should go to the AI.
	 */
	known: boolean;
}

/**
 * A short, stable hash of a section's text. Trailing spaces and runs of blank
 * lines don't count, so reformatting whitespace isn't a change.
 */
export function hashPrdSection(text: string): string {
	const normalized = text
		.replace(/\r\n?/g, '\n')
		.split('\n')
		.map((line) => line.trimEnd())
		.join('\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
	return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

/** Every section's hash, by slug: what the tag records after a parse */
export function buildPrdSnapshot(sections: PrdSection[]): PrdSnapshot {
	return Object.fromEntries(
		sections.map((section) => [section.slug, hashPrdSection(section.text)])
	);
}

/**
 * The metadata parse-prd stores on a task whose AI answer named `answer`:
 * `{ source: 'docs/prd.md#sign-up', sourceHash }`, or undefined when the
 * answer names no section of the PRD
 */
export function prdSourceMetadata(
	answer: unknown,
	sections: PrdSection[],
	prdPath: string
): { source: string; sourceHash: string } | undefined {
	const section = resolvePrdSection(answer, sections);
	if (!section) return undefined;
	return {
		source: formatPrdSource(prdPath, section.slug),
		sourceHash: hashPrdSection(section.text)
	};
}

/** The hash a task recorded for its section, when it has one */
export function getPrdSourceHash(task: {
	metadata?: Record<string, unknown>;
}): string | undefined {
	const hash = task.metadata?.[PRD_SOURCE_HASH_KEY];
	return typeof hash === 'string' && hash ? hash : undefined;
}

/**
 * The snapshot a tag's metadata holds for one PRD, or undefined. Anything
 * malformed reads as no snapshot.
 */
export function getPrdSnapshot(
	tagMetadata: Record<string, unknown> | null | undefined,
	prdPath: string
): PrdSnapshot | undefined {
	const all = tagMetadata?.[PRD_SNAPSHOT_KEY];
	if (!all || typeof all !== 'object' || Array.isArray(all)) return undefined;
	const snapshot = (all as Record<string, unknown>)[prdPath];
	if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
		return undefined;
	}
	const entries = Object.entries(snapshot).filter(
		(entry): entry is [string, string] => typeof entry[1] === 'string'
	);
	return Object.fromEntries(entries);
}

/** The tag's snapshots with one PRD's replaced */
export function withPrdSnapshot(
	tagMetadata: Record<string, unknown> | null | undefined,
	prdPath: string,
	snapshot: PrdSnapshot
): PrdSnapshots {
	const all = tagMetadata?.[PRD_SNAPSHOT_KEY];
	const current =
		all && typeof all === 'object' && !Array.isArray(all)
			? (all as PrdSnapshots)
			: {};
	return { ...current, [prdPath]: snapshot };
}

/**
 * Compare a PRD with what its tasks and the tag recorded.
 *
 * With a snapshot (any parse since section hashes were recorded) it is the
 * baseline. Without one, the tasks citing this PRD are: a section one of them
 * cites, or a section above or below that, counts as known, and a task's
 * `sourceHash`, when it has one, tells whether its section changed.
 * Cancelled tasks are ignored.
 *
 * @param sections - The PRD's sections now (`parsePrdSections`)
 * @param prdPath - The PRD as tasks cite it (`prdPathForSource`)
 * @param tasks - Top-level tasks of the tag
 * @param snapshot - The tag's snapshot for this PRD, if it has one
 */
export function diffPrdSections(
	sections: PrdSection[],
	prdPath: string,
	tasks: PrdDeltaTask[],
	snapshot?: PrdSnapshot
): PrdDelta {
	// Tasks citing each section of this PRD, and the hash each one recorded
	const citing = new Map<
		string,
		Array<{ id: number | string; hash?: string }>
	>();
	for (const task of tasks) {
		if (task.status === 'cancelled') continue;
		const source = parsePrdSource(getPrdSource(task));
		if (!source || source.path !== prdPath) continue;
		const list = citing.get(source.slug) ?? [];
		list.push({ id: task.id, hash: getPrdSourceHash(task) });
		citing.set(source.slug, list);
	}

	const bySlug = new Map(sections.map((s) => [s.slug, s]));
	const known = snapshot
		? new Set(Object.keys(snapshot))
		: knownFromTasks(sections, bySlug, citing);

	const delta: PrdDelta = {
		path: prdPath,
		added: [],
		changed: [],
		removed: [],
		unchanged: 0,
		known: known.size > 0 || citing.size > 0
	};

	for (const section of sections) {
		if (!known.has(section.slug)) {
			delta.added.push(section);
			continue;
		}
		const hash = hashPrdSection(section.text);
		const cited = citing.get(section.slug) ?? [];
		const before = snapshot?.[section.slug];
		const changed =
			before !== undefined
				? before !== hash
				: cited.some((task) => task.hash !== undefined && task.hash !== hash);
		if (changed) {
			delta.changed.push({
				slug: section.slug,
				title: section.title,
				taskIds: cited.map((task) => task.id)
			});
		} else {
			delta.unchanged++;
		}
	}

	// Like a change, a removal is reported once: after this run the snapshot
	// no longer has it. validate-dependencies keeps reporting tasks that cite it
	const previous = snapshot ? Object.keys(snapshot) : [...citing.keys()];
	for (const slug of previous) {
		if (bySlug.has(slug)) continue;
		delta.removed.push({
			slug,
			taskIds: (citing.get(slug) ?? []).map((task) => task.id)
		});
	}

	return delta;
}

/** Without a snapshot: sections tasks cite, and those above or below them */
function knownFromTasks(
	sections: PrdSection[],
	bySlug: Map<string, PrdSection>,
	citing: Map<string, unknown>
): Set<string> {
	const known = new Set<string>();
	const ancestors = (section: PrdSection) => {
		const chain: string[] = [];
		let parent = section.parentSlug
			? bySlug.get(section.parentSlug)
			: undefined;
		while (parent) {
			chain.push(parent.slug);
			parent = parent.parentSlug ? bySlug.get(parent.parentSlug) : undefined;
		}
		return chain;
	};
	for (const section of sections) {
		const above = ancestors(section);
		if (citing.has(section.slug)) {
			known.add(section.slug);
			for (const slug of above) known.add(slug);
		} else if (above.some((slug) => citing.has(slug))) {
			known.add(section.slug);
		}
	}
	return known;
}

/** Whether the PRD differs in any way from what was recorded */
export function hasPrdChanges(delta: PrdDelta): boolean {
	return (
		delta.added.length > 0 ||
		delta.changed.length > 0 ||
		delta.removed.length > 0
	);
}

/**
 * The text that goes to the AI for the new sections: each one's heading and
 * own text, in document order. The whole PRD when nothing was known about it.
 */
export function prdDeltaContent(delta: PrdDelta, prdContent: string): string {
	if (!delta.known) return prdContent;
	return delta.added.map((section) => section.text).join('\n\n');
}
