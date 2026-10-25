/**
 * @fileoverview Which PRD sections have tasks, read from each task's
 * `metadata.source` (`docs/prd.md#authentication`).
 *
 * A section counts as covered when a task cites it, a section inside it, or
 * the section it sits in: a task for "Authentication" covers "Password
 * reset" under it, and a task for "Password reset" covers "Authentication".
 * A task that cites a heading the PRD no longer has (renamed or removed) is
 * reported, never silently dropped, and the renamed heading shows up as
 * uncovered. Cancelled tasks neither cover a section nor need one, and the
 * `## Clarifications` section parse-prd --clarify writes needs no task.
 */

import fs from 'node:fs';
import path from 'node:path';
import { isClarificationsHeading } from './clarifications.js';
import {
	type PrdSection,
	getPrdSource,
	parsePrdSections,
	parsePrdSource
} from './prd-sections.js';

export interface PrdCoverageTask {
	id: number | string;
	title?: string;
	status?: string;
	metadata?: Record<string, unknown>;
}

export interface PrdFileCoverage {
	/** As tasks cite it, relative to the project root */
	path: string;
	/** The file couldn't be read */
	missing: boolean;
	/** Tasks citing this file, in task order */
	taskIds: Array<number | string>;
	sectionCount: number;
	/** Sections no task covers, in document order */
	uncovered: Array<Pick<PrdSection, 'slug' | 'title' | 'level'>>;
	/** Tasks citing a heading this file no longer has */
	stale: Array<{ taskId: number | string; slug: string }>;
}

export interface PrdCoverage {
	files: PrdFileCoverage[];
	/** Tasks with no PRD section, when other tasks have one */
	unsourced: Array<{ id: number | string; title: string }>;
}

/**
 * Coverage of every PRD the tasks cite. Null when no task has a source, so a
 * project that never ran parse-prd isn't told all its tasks lack one.
 *
 * @param tasks - Top-level tasks of one tag (subtasks inherit their parent's source)
 * @param readPrd - Contents of a PRD by the path tasks cite, or null if unreadable
 */
export function computePrdCoverage(
	tasks: PrdCoverageTask[],
	readPrd: (prdPath: string) => string | null
): PrdCoverage | null {
	const active = tasks.filter((task) => task.status !== 'cancelled');
	const citations = new Map<
		string,
		Array<{ taskId: number | string; slug: string }>
	>();
	const unsourced: PrdCoverage['unsourced'] = [];

	for (const task of active) {
		const source = parsePrdSource(getPrdSource(task));
		if (!source) {
			unsourced.push({ id: task.id, title: task.title ?? '' });
			continue;
		}
		const list = citations.get(source.path) ?? [];
		list.push({ taskId: task.id, slug: source.slug });
		citations.set(source.path, list);
	}
	if (citations.size === 0) return null;

	const files = [...citations].map(([prdPath, cited]) =>
		fileCoverage(prdPath, cited, readPrd(prdPath))
	);
	return { files, unsourced };
}

function fileCoverage(
	prdPath: string,
	cited: Array<{ taskId: number | string; slug: string }>,
	content: string | null
): PrdFileCoverage {
	const taskIds = cited.map((c) => c.taskId);
	if (content === null) {
		return {
			path: prdPath,
			missing: true,
			taskIds,
			sectionCount: 0,
			uncovered: [],
			stale: []
		};
	}

	const sections = parsePrdSections(content);
	const bySlug = new Map(sections.map((s) => [s.slug, s]));
	const ancestors = (section: PrdSection): string[] => {
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

	const citedSlugs = new Set<string>();
	const covered = new Set<string>();
	const stale: PrdFileCoverage['stale'] = [];
	for (const { taskId, slug } of cited) {
		const section = bySlug.get(slug);
		if (!section) {
			stale.push({ taskId, slug });
			continue;
		}
		citedSlugs.add(slug);
		covered.add(slug);
		for (const slugAbove of ancestors(section)) covered.add(slugAbove);
	}
	for (const section of sections) {
		if (ancestors(section).some((slug) => citedSlugs.has(slug))) {
			covered.add(section.slug);
		}
	}

	return {
		path: prdPath,
		missing: false,
		taskIds,
		sectionCount: sections.length,
		uncovered: sections
			.filter(
				(s) =>
					!covered.has(s.slug) && !isClarificationsHeading(s.title, s.level)
			)
			.map(({ slug, title, level }) => ({ slug, title, level })),
		stale
	};
}

/** Larger files aren't PRDs; reading one would stall validate-dependencies */
export const MAX_PRD_BYTES = 10 * 1024 * 1024;

/**
 * `computePrdCoverage` with each PRD read from disk. Relative paths are read
 * from the project root, as parse-prd stores them. `metadata.source` comes
 * from the task file, so only a regular file up to `MAX_PRD_BYTES` is read:
 * a source naming `/dev/zero` or a FIFO counts as unreadable instead of
 * hanging the check.
 */
export function checkPrdCoverage(
	tasks: PrdCoverageTask[],
	projectRoot: string
): PrdCoverage | null {
	return computePrdCoverage(tasks, (prdPath) =>
		readPrdFile(path.resolve(projectRoot, prdPath))
	);
}

/** A regular file up to `MAX_PRD_BYTES`, or null */
function readPrdFile(file: string): string | null {
	try {
		const stat = fs.statSync(file);
		if (!stat.isFile() || stat.size > MAX_PRD_BYTES) return null;
		return fs.readFileSync(file, 'utf8');
	} catch {
		return null;
	}
}

/**
 * The text of the section a `metadata.source` cites, subsections included,
 * as written in the PRD; undefined when the file or heading is gone. Only a
 * file inside the project is read, since the source comes from the task file.
 */
export function readPrdSection(
	source: string,
	projectRoot: string
): string | undefined {
	const parsed = parsePrdSource(source);
	if (!parsed) return undefined;
	let file: string;
	try {
		const root = fs.realpathSync(projectRoot);
		file = fs.realpathSync(path.resolve(root, parsed.path));
		const relative = path.relative(root, file);
		if (
			!relative ||
			relative === '..' ||
			relative.startsWith(`..${path.sep}`) ||
			path.isAbsolute(relative)
		) {
			return undefined;
		}
	} catch {
		return undefined;
	}
	const content = readPrdFile(file);
	if (content === null) return undefined;
	const sections = parsePrdSections(content);
	const start = sections.findIndex((s) => s.slug === parsed.slug);
	if (start === -1) return undefined;
	const end = sections.findIndex(
		(s, i) => i > start && s.level <= sections[start].level
	);
	return content
		.replace(/\r\n?/g, '\n')
		.split('\n')
		.slice(
			sections[start].line - 1,
			end === -1 ? undefined : sections[end].line - 1
		)
		.join('\n')
		.trimEnd();
}

/** Whether coverage found anything worth telling the user */
export function hasPrdCoverageGaps(coverage: PrdCoverage | null): boolean {
	if (!coverage) return false;
	return (
		coverage.unsourced.length > 0 ||
		coverage.files.some(
			(file) =>
				file.missing || file.uncovered.length > 0 || file.stale.length > 0
		)
	);
}
