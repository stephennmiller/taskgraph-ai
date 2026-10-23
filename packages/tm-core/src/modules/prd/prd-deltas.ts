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
 * Sections are matched by text before slug. A repeated heading's slug
 * depends on its position (`setup`, `setup-1`), so inserting a "Setup" above
 * another shifts the later ones: their text is found under the new slug and
 * they stay unchanged, and the inserted one is new. A section whose text
 * matches one recorded before is never offered as new.
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

	// What was recorded before: each slug with the hashes known for it. A
	// snapshot has one per slug; tasks may have none (made before hashes)
	const previous: Array<{ slug: string; hashes: Set<string> }> = snapshot
		? Object.entries(snapshot).map(([slug, hash]) => ({
				slug,
				hashes: new Set([hash])
			}))
		: [...citing].map(([slug, cited]) => ({
				slug,
				hashes: new Set(cited.flatMap((task) => (task.hash ? [task.hash] : [])))
			}));

	const delta: PrdDelta = {
		path: prdPath,
		added: [],
		changed: [],
		removed: [],
		unchanged: 0,
		known: previous.length > 0
	};

	const hashes = sections.map((section) => hashPrdSection(section.text));
	const matched = new Set<(typeof previous)[number]>();
	const outcome: Array<'unchanged' | 'changed' | undefined> = [];
	const claim = (
		i: number,
		find: (entry: (typeof previous)[number]) => boolean,
		result: 'unchanged' | 'changed'
	) => {
		if (outcome[i]) return;
		const entry = previous.find((e) => !matched.has(e) && find(e));
		if (!entry) return;
		matched.add(entry);
		outcome[i] = result;
	};
	// Same slug and text, then same text under another slug, then same slug
	// with other text: a change, unless nothing recorded its text
	sections.forEach((section, i) =>
		claim(
			i,
			(e) => e.slug === section.slug && e.hashes.has(hashes[i]),
			'unchanged'
		)
	);
	sections.forEach((_, i) =>
		claim(i, (e) => e.hashes.has(hashes[i]), 'unchanged')
	);
	sections.forEach((section, i) =>
		claim(i, (e) => e.slug === section.slug && e.hashes.size > 0, 'changed')
	);
	sections.forEach((section, i) =>
		claim(i, (e) => e.slug === section.slug, 'unchanged')
	);

	// Without a snapshot, sections above or below a matched one count as
	// known too: their tasks may cite the section around them
	const near = snapshot
		? new Set<string>()
		: knownAround(
				sections,
				new Set(sections.filter((_, i) => outcome[i]).map((s) => s.slug))
			);

	sections.forEach((section, i) => {
		const result =
			outcome[i] ?? (near.has(section.slug) ? 'unchanged' : undefined);
		if (result === 'unchanged') {
			delta.unchanged++;
		} else if (result === 'changed') {
			delta.changed.push({
				slug: section.slug,
				title: section.title,
				taskIds: (citing.get(section.slug) ?? []).map((task) => task.id)
			});
		} else {
			delta.added.push(section);
		}
	});

	// Like a change, a removal is reported once: after this run the snapshot
	// no longer has it. validate-dependencies keeps reporting tasks that cite it
	for (const entry of previous) {
		if (matched.has(entry)) continue;
		delta.removed.push({
			slug: entry.slug,
			taskIds: (citing.get(entry.slug) ?? []).map((task) => task.id)
		});
	}

	return delta;
}

/** Sections above or below any of `matched` */
function knownAround(
	sections: PrdSection[],
	matched: Set<string>
): Set<string> {
	const bySlug = new Map(sections.map((s) => [s.slug, s]));
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
	const known = new Set<string>();
	for (const section of sections) {
		const above = ancestors(section);
		if (matched.has(section.slug)) {
			for (const slug of above) known.add(slug);
		} else if (above.some((slug) => matched.has(slug))) {
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
