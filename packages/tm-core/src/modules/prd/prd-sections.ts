/**
 * @fileoverview A PRD's sections, named the way GitHub names heading anchors,
 * so a task can record where it came from as `docs/prd.md#authentication`.
 *
 * parse-prd gives the AI the list of slugs, asks it to name the section each
 * task implements, and keeps only answers that match a slug
 * (`resolvePrdSection`). `metadata.source` holds the result.
 */

import nodePath from 'node:path';

/** Where a task came from in `metadata.source`: `docs/prd.md#authentication` */
export const PRD_SOURCE_KEY = 'source';

export interface PrdSection {
	/** GitHub-style anchor, unique in the document: `authentication`, `setup-1` */
	slug: string;
	/** Heading text as written, without the `#` marks */
	title: string;
	/** 1 for `#`, 2 for `##`, ... */
	level: number;
	/** 1-based line of the heading */
	line: number;
	/** Slug of the nearest enclosing heading, if any */
	parentSlug?: string;
	/**
	 * The section's own text: the heading line and everything up to the next
	 * heading of any level. Subsections are not included.
	 */
	text: string;
}

/**
 * The anchor GitHub gives a heading: lowercase, punctuation removed, each
 * space a hyphen. `Sign-in & Sessions` → `sign-in--sessions`.
 */
export function slugifyHeading(heading: string): string {
	return stripInlineMarkdown(heading)
		.trim()
		.toLowerCase()
		.replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
		.replace(/ /g, '-');
}

/** Heading text as GitHub renders it: links and images as their text, no code or emphasis marks */
function stripInlineMarkdown(text: string): string {
	return text
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/<[^>]+>/g, '')
		.replace(/[`*]/g, '');
}

const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;

/**
 * Every heading in a markdown document, in order. Headings in fenced code and
 * YAML front matter are skipped. A repeated heading gets `-1`, `-2`, ... as
 * GitHub does, never a slug another heading already uses.
 */
export function parsePrdSections(markdown: string): PrdSection[] {
	const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
	const found: Array<{ title: string; level: number; index: number }> = [];

	let fence: string | null = null;
	let start = 0;
	if (lines[0]?.trim() === '---') {
		const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
		if (end > 0) start = end + 1;
	}

	for (let i = start; i < lines.length; i++) {
		const line = lines[i];
		const fenceMatch = FENCE.exec(line);
		if (fence) {
			if (
				fenceMatch &&
				fenceMatch[1][0] === fence[0] &&
				fenceMatch[1].length >= fence.length
			) {
				fence = null;
			}
			continue;
		}
		if (fenceMatch) {
			fence = fenceMatch[1];
			continue;
		}

		const atx = ATX.exec(line);
		if (atx) {
			const title = (atx[2] ?? '').trim();
			if (title) {
				found.push({ title, level: atx[1].length, index: i });
			}
			continue;
		}

		// `Title` over `===` or `---` is a heading when the line above is plain text
		const next = lines[i + 1];
		const setext = next !== undefined ? SETEXT.exec(next) : null;
		if (setext && isParagraphLine(line) && !isParagraphLine(lines[i - 1])) {
			found.push({
				title: line.trim(),
				level: setext[1][0] === '=' ? 1 : 2,
				index: i
			});
			i++;
		}
	}

	const used = new Set<string>();
	const counts = new Map<string, number>();
	const stack: PrdSection[] = [];
	return found.map((heading, n) => {
		const slug = uniqueSlug(slugifyHeading(heading.title), used, counts);
		while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) {
			stack.pop();
		}
		const end = found[n + 1]?.index ?? lines.length;
		const section: PrdSection = {
			slug,
			title: heading.title,
			level: heading.level,
			line: heading.index + 1,
			text: lines.slice(heading.index, end).join('\n').trim()
		};
		const parent = stack[stack.length - 1];
		if (parent) section.parentSlug = parent.slug;
		stack.push(section);
		return section;
	});
}

/** Plain text that could be a paragraph or a setext heading's title */
function isParagraphLine(line: string | undefined): boolean {
	if (line === undefined || line.trim() === '') return false;
	return (
		!ATX.test(line) &&
		!FENCE.test(line) &&
		!SETEXT.test(line) &&
		!/^ {0,3}([-*+]|\d+[.)])[ \t]/.test(line) &&
		!/^ {0,3}>/.test(line)
	);
}

/** `setup`, then `setup-1`, `setup-2`, skipping any a heading already took */
function uniqueSlug(
	base: string,
	used: Set<string>,
	counts: Map<string, number>
): string {
	let slug = base;
	let count = counts.get(base) ?? 0;
	while (used.has(slug)) {
		count++;
		slug = `${base}-${count}`;
	}
	counts.set(base, count);
	used.add(slug);
	return slug;
}

/** `docs/prd.md#authentication`, with `/` separators on every platform */
export function formatPrdSource(prdPath: string, slug: string): string {
	return `${prdPath.replace(/\\/g, '/')}#${slug}`;
}

/** The PRD path and slug of a `metadata.source` value, or null when it isn't one */
export function parsePrdSource(
	source: unknown
): { path: string; slug: string } | null {
	if (typeof source !== 'string') return null;
	const hash = source.lastIndexOf('#');
	if (hash <= 0 || hash === source.length - 1) return null;
	return { path: source.slice(0, hash), slug: source.slice(hash + 1) };
}

/** A task's `metadata.source`, when it has one */
export function getPrdSource(task: {
	metadata?: Record<string, unknown>;
}): string | undefined {
	const source = task.metadata?.[PRD_SOURCE_KEY];
	return typeof source === 'string' && source ? source : undefined;
}

/**
 * The section an AI answer names, or undefined. Accepts the slug, `#slug`,
 * `prd.md#slug` or the heading text; anything else is dropped rather than
 * stored as a source that points nowhere.
 */
export function resolvePrdSection(
	answer: unknown,
	sections: PrdSection[]
): PrdSection | undefined {
	if (typeof answer !== 'string') return undefined;
	const trimmed = answer.trim();
	if (!trimmed) return undefined;
	const afterHash = trimmed.includes('#')
		? trimmed.slice(trimmed.lastIndexOf('#') + 1)
		: trimmed;
	const bySlug = (slug: string) => sections.find((s) => s.slug === slug);
	return (
		bySlug(afterHash) ??
		bySlug(afterHash.toLowerCase()) ??
		bySlug(slugifyHeading(afterHash)) ??
		sections.find((s) => s.title.trim().toLowerCase() === trimmed.toLowerCase())
	);
}

/**
 * The list of sections parse-prd puts in the prompt, one per line:
 * `authentication  (Authentication)`, indented by level
 */
export function formatPrdSectionList(sections: PrdSection[]): string {
	const top = Math.min(...sections.map((s) => s.level));
	return sections
		.map(
			(s) =>
				`${'  '.repeat(s.level - top)}- ${s.slug} (${s.title.replace(/\s+/g, ' ')})`
		)
		.join('\n');
}

/**
 * The `metadata.source` for a task whose AI answer named `answer`, or
 * undefined when it names no section of the PRD
 */
export function prdSourceFor(
	answer: unknown,
	sections: PrdSection[],
	prdPath: string
): string | undefined {
	const section = resolvePrdSection(answer, sections);
	return section ? formatPrdSource(prdPath, section.slug) : undefined;
}

/**
 * How tasks name a PRD file: relative to the project root, `/` separated.
 * A file outside the project keeps its absolute path.
 *
 * @param prdPath - Absolute, or relative to the working directory as the
 *   user typed it
 */
export function prdPathForSource(projectRoot: string, prdPath: string): string {
	const absolute = nodePath.resolve(prdPath);
	const relative = nodePath.relative(nodePath.resolve(projectRoot), absolute);
	const outside =
		relative === '' ||
		relative.startsWith('..') ||
		nodePath.isAbsolute(relative);
	return (outside ? absolute : relative).replace(/\\/g, '/');
}
