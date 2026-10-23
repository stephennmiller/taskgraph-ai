/**
 * @fileoverview What `parse-prd --clarify` says around its questions, e.g.
 *
 *   3 questions about prd.md · Enter keeps the suggested answer
 *   ✔ Which database should the app use? PostgreSQL 16
 *   ✔ How do users sign in? Email and password
 *   ✔ Is there a mobile app? No, web only
 *   ✓ Saved 3 answers to prd.md under ## Clarifications
 *
 * or, with --yes or without a terminal:
 *
 *   Accepted the suggested answers to 3 questions (no terminal to ask in)
 *   ✓ Saved 3 answers to prd.md under ## Clarifications
 */

import chalk from 'chalk';
import { theme } from '../theme.js';

const questions = (count: number) =>
	`${count} ${count === 1 ? 'question' : 'questions'}`;

/** The line above the prompts */
export function formatClarifyIntro(count: number, prdName: string): string {
	return `${questions(count)} about ${prdName}${theme.muted(' · Enter keeps the suggested answer')}`;
}

/** `✔ Which database should the app use? PostgreSQL 16`, as inquirer shows an answer */
export function formatClarifyAnswer(question: string, answer: string): string {
	return `${chalk.green('✔')} ${chalk.bold(question)} ${chalk.cyan(answer)}`;
}

/** Nothing to ask; tasks are generated straight away */
export function formatNoClarifyQuestions(prdName: string): string {
	return theme.muted(`No open questions about ${prdName}`);
}

/** Why the suggested answers were taken without asking */
export type AcceptedReason = 'yes' | 'no-terminal';

/** One line saying the suggested answers were used */
export function formatAcceptedSuggestions(
	count: number,
	reason: AcceptedReason
): string {
	const why = reason === 'yes' ? '--yes' : 'no terminal to ask in';
	return `Accepted the suggested ${count === 1 ? 'answer' : 'answers'} to ${questions(count)} ${theme.muted(`(${why})`)}`;
}

export interface ClarificationsSaved {
	added: number;
	updated: number;
	unchanged: number;
}

/** What writing the answers into the PRD changed */
export function formatClarificationsSaved(
	result: ClarificationsSaved,
	prdName: string
): string {
	const saved = result.added + result.updated;
	if (saved === 0) {
		return theme.muted(`${prdName} already has these answers`);
	}
	const facts = result.updated > 0 ? ` · ${result.updated} replaced` : '';
	return `${chalk.green('✓')} Saved ${saved} ${saved === 1 ? 'answer' : 'answers'} to ${prdName} under ## Clarifications${theme.muted(facts)}`;
}

/** Ctrl-C at a question */
export function formatClarifyCancelled(prdName: string): string {
	return theme.muted(`Cancelled; ${prdName} unchanged and no tasks generated`);
}
