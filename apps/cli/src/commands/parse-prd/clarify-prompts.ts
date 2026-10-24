/**
 * @fileoverview The questions `parse-prd --clarify` asks before it generates
 * tasks. Each question starts on its suggested answer, so Enter accepts it.
 * Without a terminal, or with --yes, the suggested answers are taken and one
 * line says so.
 */

import {
	acceptSuggestedAnswers,
	type Clarification,
	type ClarifyingQuestion
} from '@tm/core';
import {
	formatAcceptedSuggestions,
	formatClarifyAnswer,
	formatClarifyIntro
} from '../../ui/formatters/clarify-formatters.js';

export interface CollectClarificationsOptions {
	/** The PRD's name as the user knows it, e.g. `prd.md` */
	prdName: string;
	/** --yes: take the suggested answers without asking */
	yes?: boolean;
	/** Whether stdin and stdout are terminals; defaults to checking both */
	interactive?: boolean;
}

/** Inquirer throws this when the user presses Ctrl-C */
const isPromptExit = (error: unknown) =>
	error instanceof Error && error.name === 'ExitPromptError';

/**
 * Get an answer to each question: from the user in a terminal, otherwise the
 * suggested ones.
 *
 * @returns The answers, or null when the user pressed Ctrl-C
 */
export async function collectClarifications(
	questions: ClarifyingQuestion[],
	options: CollectClarificationsOptions
): Promise<Clarification[] | null> {
	if (questions.length === 0) return [];

	const interactive =
		options.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
	if (options.yes || !interactive) {
		console.log(
			formatAcceptedSuggestions(
				questions.length,
				options.yes ? 'yes' : 'no-terminal'
			)
		);
		return acceptSuggestedAnswers(questions);
	}

	console.log(formatClarifyIntro(questions.length, options.prdName));
	// Cleared when done so Ctrl-C leaves nothing half-drawn; the answer line
	// is printed here instead
	const { default: inquirer } = await import('inquirer');
	const ask = inquirer.createPromptModule({ clearPromptOnDone: true });
	const answers: Clarification[] = [];
	try {
		for (const { question, suggestedAnswer } of questions) {
			const { answer } = await ask<{ answer: string }>([
				{
					type: 'input',
					name: 'answer',
					message: question,
					default: suggestedAnswer || undefined
				}
			]);
			const text = (answer ?? '').trim() || suggestedAnswer;
			if (!text) continue;
			console.log(formatClarifyAnswer(question, text));
			answers.push({ question, answer: text });
		}
	} catch (error) {
		if (isPromptExit(error)) return null;
		throw error;
	}
	return answers;
}
