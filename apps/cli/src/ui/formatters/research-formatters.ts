/**
 * @fileoverview What `research` tells you around the answer, e.g.
 *
 *   Context: task 3 · related 1, 2, 4 · README.md · project tree
 *   ⠋ Researching… 12s
 *   <the answer, rendered once>
 *   ✓ Saved to task 3
 *
 * They replace a boxed "AI Research Query" banner, a boxed per-task token
 * table, and the answer printed twice (streamed raw, then again in a box).
 */

import { stripVTControlCharacters } from 'node:util';
import chalk from 'chalk';
import { Marked, type MarkedExtension } from 'marked';
import { markedTerminal } from 'marked-terminal';
import { theme } from '../theme.js';

/** Answers wrap at the terminal width, but no wider than this */
const MAX_ANSWER_WIDTH = 100;

const visibleLength = (text: string) => stripVTControlCharacters(text).length;

/**
 * Wrap a line at spaces without counting ANSI codes, starting each
 * continuation line with `indent`.
 */
function wrapLine(line: string, width: number, indent: string): string[] {
	const lead = line.match(/^ */)?.[0] ?? '';
	const words = line.slice(lead.length).split(' ');
	const lines: string[] = [];
	let current = lead;
	let length = lead.length;
	let lineHasWord = false;

	for (const word of words) {
		const wordLength = visibleLength(word);
		if (lineHasWord && length + 1 + wordLength > width) {
			lines.push(current);
			current = indent + word;
			length = indent.length + wordLength;
		} else {
			current += (lineHasWord ? ' ' : '') + word;
			length += (lineHasWord ? 1 : 0) + wordLength;
		}
		lineHasWord = true;
	}
	lines.push(current);
	return lines;
}

/**
 * marked-terminal reflows paragraphs but not list items, so long items
 * relied on the terminal's own wrap and lost their indent. Wrap them with
 * a hanging indent, and draw bullets as •.
 */
function wrapListItems(text: string, width: number): string {
	return text
		.split('\n')
		.flatMap((line) => {
			const bulleted = line.replace(/^(\s*)\* /, '$1• ');
			const marker =
				stripVTControlCharacters(bulleted).match(/^(\s*)(•|\d+\.)\s+/);
			if (!marker || visibleLength(bulleted) <= width) return [bulleted];
			return wrapLine(bulleted, width, ' '.repeat(marker[0].length));
		})
		.join('\n');
}

/**
 * Render a research answer's markdown for the terminal, wrapped to the
 * terminal width (at most 100 columns). Any <think>…</think> reasoning is
 * dropped.
 */
export function formatResearchAnswer(
	markdown: string,
	width = process.stdout.columns || 80
): string {
	const columns = Math.max(40, Math.min(width, MAX_ANSWER_WIDTH));
	const renderer = new Marked({ gfm: true, breaks: false });

	renderer.use(
		markedTerminal({
			code: (code: string) =>
				code
					.split('\n')
					.map((line) => chalk.cyan(line))
					.join('\n'),
			blockquote: theme.muted.italic,
			html: theme.muted,
			heading: theme.text.bold,
			firstHeading: theme.text.bold,
			hr: theme.muted,
			listitem: theme.text,
			paragraph: theme.text,
			strong: theme.text.bold,
			em: theme.text.italic,
			codespan: chalk.cyan,
			del: chalk.dim.strikethrough,
			link: theme.brand,
			href: theme.brand.underline,
			showSectionPrefix: false,
			unescape: true,
			emoji: false,
			tab: 2,
			width: columns,
			reflowText: true
		}) as MarkedExtension
	);

	// marked-terminal prints list items' inline markdown (**bold**, `code`)
	// literally; render their inline tokens instead.
	renderer.use({
		renderer: {
			text(token) {
				if (typeof token === 'object' && 'tokens' in token && token.tokens) {
					return this.parser.parseInline(token.tokens);
				}
				return typeof token === 'string' ? token : token.text;
			}
		}
	});

	const answer = markdown.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
	const rendered = renderer.parse(answer, { async: false }) as string;
	return wrapListItems(rendered.trimEnd(), columns);
}

export interface ResearchContextSummary {
	/** Task IDs you passed with --id */
	taskIds: string[];
	/** Task IDs found by searching for the question */
	relatedTaskIds: string[];
	/** File paths you passed with --files */
	files: string[];
	/** --tree */
	projectTree?: boolean;
	/** --context */
	customContext?: boolean;
}

/** Where `research` saved the answer */
export type ResearchSaveTarget =
	| { kind: 'task'; id: string }
	| { kind: 'file'; path: string };

/** Sorts `10, 2, 3.2` as `2, 3.2, 10` */
export function sortTaskIds(ids: string[]): string[] {
	const parts = (id: string) =>
		id.split('.').map((n) => Number.parseInt(n, 10));
	return [...ids].sort((a, b) => {
		const [pa, pb] = [parts(a), parts(b)];
		for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
			const diff = (pa[i] ?? -1) - (pb[i] ?? -1);
			if (diff !== 0) return diff;
		}
		return 0;
	});
}

const taskLabel = (ids: string[]) =>
	`${ids.length === 1 ? 'task' : 'tasks'} ${sortTaskIds(ids).join(', ')}`;

/**
 * One muted line saying what the question will be asked with, or '' when
 * there is no project context.
 */
export function formatResearchContext(summary: ResearchContextSummary): string {
	const parts: string[] = [];
	const { taskIds, relatedTaskIds, files } = summary;

	if (taskIds.length > 0) parts.push(taskLabel(taskIds));
	if (relatedTaskIds.length > 0) {
		parts.push(
			taskIds.length > 0
				? `related ${sortTaskIds(relatedTaskIds).join(', ')}`
				: `related ${taskLabel(relatedTaskIds)}`
		);
	}
	if (files.length > 0) {
		parts.push(files.length <= 2 ? files.join(', ') : `${files.length} files`);
	}
	if (summary.projectTree) parts.push('project tree');
	if (summary.customContext) parts.push('your notes');

	if (parts.length === 0) return '';
	return theme.muted(`Context: ${parts.join(' · ')}`);
}

/** `✓ Saved to task 3` or `✓ Saved to .taskgraph/docs/research/….md` */
export function formatResearchSaved(target: ResearchSaveTarget): string {
	const where =
		target.kind === 'file'
			? target.path
			: `${target.id.includes('.') ? 'subtask' : 'task'} ${target.id}`;
	return `${chalk.green('✓')} Saved to ${where}`;
}

/** `✗ Couldn't save to task 9: Task 9 doesn't exist` */
export function formatResearchSaveFailed(
	target: ResearchSaveTarget,
	reason: string
): string {
	const where =
		target.kind === 'file'
			? 'a file'
			: `${target.id.includes('.') ? 'subtask' : 'task'} ${target.id}`;
	return `${chalk.red('✗')} Couldn't save to ${where}: ${reason}`;
}
