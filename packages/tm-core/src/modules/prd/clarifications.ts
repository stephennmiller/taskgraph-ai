/**
 * @fileoverview The `## Clarifications` section of a PRD.
 *
 * `parse-prd --clarify` asks a few questions about gaps in the PRD before it
 * generates tasks. The answers are written into the PRD itself, so the record
 * lives in the repo and the task generation reads them like any other
 * requirement:
 *
 *   ## Clarifications
 *
 *   - **Q:** Which database should the app use?
 *     **A:** PostgreSQL 16
 *
 * Writing is idempotent: an answer already recorded is left alone, and a new
 * answer to a question already in the section replaces the old one, so the PRD
 * never states two answers to the same question.
 */

import fs from 'node:fs';
import {
	ERROR_CODES,
	TaskGraphError
} from '../../common/errors/taskgraph-error.js';
import { refuseSymlinkSync } from '../storage/adapters/file-storage/file-operations.js';

/** The most questions one `--clarify` run asks */
export const MAX_CLARIFYING_QUESTIONS = 5;

export const CLARIFICATIONS_HEADING = '## Clarifications';

/** The most answers one `--answers` file or MCP call may save */
export const MAX_CLARIFICATION_ANSWERS = 25;

/** The longest question or answer, in characters, that is saved in the PRD */
export const MAX_CLARIFICATION_LENGTH = 1000;

/** A question about the PRD, with the answer used when the user just presses Enter */
export interface ClarifyingQuestion {
	question: string;
	suggestedAnswer: string;
}

/** An answered question, as written into the PRD */
export interface Clarification {
	question: string;
	answer: string;
}

/** What writing clarifications into a PRD changed */
export interface ApplyClarificationsResult {
	content: string;
	/** New questions appended to the section */
	added: number;
	/** Questions already in the section whose answer changed */
	updated: number;
	/** Questions already in the section with the same answer */
	unchanged: number;
	/** Whether the section was created by this call */
	createdSection: boolean;
	changed: boolean;
}

const HEADING_LINE = /^##\s+Clarifications\s*$/i;

/**
 * Whether a PRD heading is the `## Clarifications` section. It refines the
 * requirements above it, so no task needs to cite it
 */
export const isClarificationsHeading = (title: string, level: number) =>
	level === 2 && /^clarifications$/i.test(title.trim());
const SECTION_END = /^#{1,2}\s/;
const QUESTION_LINE = /^-\s+\*\*Q:\*\*\s*(.*)$/;
const ANSWER_LINE = /^\s+\*\*A:\*\*\s*(.*)$/;

/**
 * Questions and answers are kept on one line each, without control
 * characters: they come from the model or from answers JSON, and are shown in
 * the terminal and written into the PRD
 */
const oneLine = (text: string): string =>
	text
		.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

/** Two questions are the same if they differ only in case and spacing */
const questionKey = (text: string): string =>
	oneLine(text)
		.toLowerCase()
		.replace(/[?.!:\s]+$/, '');

interface Section {
	/** Line index of the heading */
	start: number;
	/** Line index just past the section's last line */
	end: number;
	entries: Array<Clarification & { answerLine: number }>;
}

function findSection(lines: string[]): Section | null {
	const start = lines.findIndex((line) => HEADING_LINE.test(line));
	if (start < 0) return null;
	let end = lines.length;
	for (let i = start + 1; i < lines.length; i++) {
		if (SECTION_END.test(lines[i])) {
			end = i;
			break;
		}
	}
	const entries: Section['entries'] = [];
	for (let i = start + 1; i < end - 1; i++) {
		const question = QUESTION_LINE.exec(lines[i]);
		const answer = question ? ANSWER_LINE.exec(lines[i + 1]) : null;
		if (question && answer) {
			entries.push({
				question: oneLine(question[1]),
				answer: oneLine(answer[1]),
				answerLine: i + 1
			});
			i++;
		}
	}
	return { start, end, entries };
}

/** The clarifications already recorded in a PRD, in order */
export function readClarifications(prdContent: string): Clarification[] {
	const section = findSection(prdContent.split(/\r?\n/));
	return (section?.entries ?? []).map(({ question, answer }) => ({
		question,
		answer
	}));
}

const formatEntry = ({ question, answer }: Clarification): string[] => [
	`- **Q:** ${question}`,
	`  **A:** ${answer}`
];

/**
 * Write answers into the PRD's `## Clarifications` section, creating it at
 * the end of the document if there is none. Pure: returns the new content.
 */
export function applyClarifications(
	prdContent: string,
	clarifications: Clarification[]
): ApplyClarificationsResult {
	const eol = prdContent.includes('\r\n') ? '\r\n' : '\n';
	const lines = prdContent.split(/\r?\n/);
	const section = findSection(lines);
	const recorded = new Map(
		(section?.entries ?? []).map((entry) => [
			questionKey(entry.question),
			entry
		])
	);

	const toAdd: Clarification[] = [];
	const seen = new Set<string>();
	let updated = 0;
	let unchanged = 0;

	for (const item of clarifications) {
		const question = oneLine(item.question);
		const answer = oneLine(item.answer);
		const key = questionKey(question);
		if (!question || !answer || seen.has(key)) continue;
		seen.add(key);

		const existing = recorded.get(key);
		if (!existing) {
			toAdd.push({ question, answer });
		} else if (existing.answer === answer) {
			unchanged++;
		} else {
			lines[existing.answerLine] = `  **A:** ${answer}`;
			updated++;
		}
	}

	const added = toAdd.length;
	const changed = added > 0 || updated > 0;
	if (!changed) {
		return {
			content: prdContent,
			added,
			updated,
			unchanged,
			createdSection: false,
			changed
		};
	}

	const newLines = toAdd.flatMap(formatEntry);
	let createdSection = false;

	if (!section) {
		// Append at the end, after one blank line
		while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
			lines.pop();
		}
		const block = [CLARIFICATIONS_HEADING, '', ...newLines];
		lines.push(...(lines.length > 0 ? ['', ...block] : block), '');
		createdSection = added > 0;
	} else if (added > 0) {
		// After the section's last non-blank line, keeping the list together
		let last = section.end - 1;
		while (last > section.start && lines[last].trim() === '') last--;
		const continuesList = ANSWER_LINE.test(lines[last]);
		lines.splice(last + 1, 0, ...(continuesList ? [] : ['']), ...newLines);
	}

	return {
		content: lines.join(eol),
		added,
		updated,
		unchanged,
		createdSection,
		changed
	};
}

/** Read a PRD, write the answers into it, and save it if anything changed */
export function writeClarifications(
	prdPath: string,
	clarifications: Clarification[]
): ApplyClarificationsResult {
	refuseSymlinkSync(prdPath);
	const result = applyClarifications(
		fs.readFileSync(prdPath, 'utf8'),
		clarifications
	);
	if (result.changed) fs.writeFileSync(prdPath, result.content, 'utf8');
	return result;
}

/**
 * Tidy the questions the model returned: one line each, no duplicates, none
 * the PRD already answers in its Clarifications section, and at most
 * {@link MAX_CLARIFYING_QUESTIONS}.
 */
export function normalizeClarifyingQuestions(
	questions: ReadonlyArray<Partial<ClarifyingQuestion>>,
	prdContent = ''
): ClarifyingQuestion[] {
	const answered = new Set(
		readClarifications(prdContent).map((entry) => questionKey(entry.question))
	);
	const result: ClarifyingQuestion[] = [];
	for (const item of questions) {
		const question = oneLine(item.question ?? '');
		const key = questionKey(question);
		if (!question || answered.has(key)) continue;
		answered.add(key);
		result.push({
			question,
			suggestedAnswer: oneLine(item.suggestedAnswer ?? '')
		});
		if (result.length === MAX_CLARIFYING_QUESTIONS) break;
	}
	return result;
}

/** Answer every question with its suggested answer (`--yes`, or no terminal) */
export function acceptSuggestedAnswers(
	questions: ReadonlyArray<ClarifyingQuestion>
): Clarification[] {
	return questions
		.filter((item) => item.suggestedAnswer)
		.map(({ question, suggestedAnswer }) => ({
			question,
			answer: suggestedAnswer
		}));
}

function invalidAnswers(message: string): TaskGraphError {
	return new TaskGraphError(message, ERROR_CODES.INVALID_INPUT);
}

/**
 * Read answers given as JSON (`parse-prd --answers`, MCP `clarifications`).
 *
 * Takes the output of `parse-prd --clarify --json` with an `answer` added to
 * each question, or a plain array of `{question, answer}`. A question with no
 * `answer` takes its `suggestedAnswer`.
 */
export function parseClarificationAnswers(input: unknown): Clarification[] {
	const items = Array.isArray(input)
		? input
		: input && typeof input === 'object'
			? ((input as Record<string, unknown>).questions ??
				(input as Record<string, unknown>).answers)
			: undefined;
	if (!Array.isArray(items)) {
		throw invalidAnswers(
			'Answers must be a list of {"question", "answer"}, or the output of --clarify --json'
		);
	}
	if (items.length > MAX_CLARIFICATION_ANSWERS) {
		throw invalidAnswers(
			`${items.length} answers is more than the ${MAX_CLARIFICATION_ANSWERS} that can be saved at once`
		);
	}
	return items.map((item, index) => {
		const entry = (item ?? {}) as Record<string, unknown>;
		const text = (value: unknown) =>
			typeof value === 'string' ? oneLine(value) : '';
		const question = text(entry.question);
		const answer = text(entry.answer) || text(entry.suggestedAnswer);
		if (!question) {
			throw invalidAnswers(`Answer ${index + 1} has no "question"`);
		}
		if (!answer) {
			throw invalidAnswers(`"${question}" has no "answer"`);
		}
		if (
			question.length > MAX_CLARIFICATION_LENGTH ||
			answer.length > MAX_CLARIFICATION_LENGTH
		) {
			throw invalidAnswers(
				`Answer ${index + 1} is longer than ${MAX_CLARIFICATION_LENGTH} characters`
			);
		}
		return { question, answer };
	});
}
