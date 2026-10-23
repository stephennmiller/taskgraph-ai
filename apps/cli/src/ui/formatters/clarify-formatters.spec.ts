import { describe, expect, it } from 'vitest';
import {
	formatAcceptedSuggestions,
	formatClarificationsSaved,
	formatClarifyAnswer,
	formatClarifyCancelled,
	formatClarifyIntro,
	formatNoClarifyQuestions
} from './clarify-formatters.js';

const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');

describe('clarify formatters', () => {
	it('introduces the questions and how to keep a suggestion', () => {
		expect(plain(formatClarifyIntro(3, 'prd.md'))).toBe(
			'3 questions about prd.md · Enter keeps the suggested answer'
		);
		expect(plain(formatClarifyIntro(1, 'prd.md'))).toMatch(/^1 question about/);
	});

	it('shows an answer the way inquirer does', () => {
		expect(plain(formatClarifyAnswer('Which database?', 'PostgreSQL'))).toBe(
			'✔ Which database? PostgreSQL'
		);
	});

	it('says in one line that the suggested answers were taken, and why', () => {
		expect(plain(formatAcceptedSuggestions(3, 'no-terminal'))).toBe(
			'Accepted the suggested answers to 3 questions (no terminal to ask in)'
		);
		expect(plain(formatAcceptedSuggestions(1, 'yes'))).toBe(
			'Accepted the suggested answer to 1 question (--yes)'
		);
	});

	it('leads with a ✓ when answers were saved, and names replacements', () => {
		expect(
			plain(
				formatClarificationsSaved(
					{ added: 2, updated: 0, unchanged: 1 },
					'prd.md'
				)
			)
		).toBe('✓ Saved 2 answers to prd.md under ## Clarifications');
		expect(
			plain(
				formatClarificationsSaved(
					{ added: 0, updated: 1, unchanged: 0 },
					'prd.md'
				)
			)
		).toBe('✓ Saved 1 answer to prd.md under ## Clarifications · 1 replaced');
	});

	it('does not claim a save when the PRD already had the answers', () => {
		expect(
			plain(
				formatClarificationsSaved(
					{ added: 0, updated: 0, unchanged: 2 },
					'prd.md'
				)
			)
		).toBe('prd.md already has these answers');
	});

	it('keeps the other lines short and plain', () => {
		expect(plain(formatNoClarifyQuestions('prd.md'))).toBe(
			'No open questions about prd.md'
		);
		expect(plain(formatClarifyCancelled('prd.md'))).toBe(
			'Cancelled; prd.md unchanged and no tasks generated'
		);
		for (const line of [
			formatClarifyIntro(5, '.taskgraph/docs/prd.md'),
			formatAcceptedSuggestions(5, 'no-terminal'),
			formatClarificationsSaved(
				{ added: 3, updated: 2, unchanged: 0 },
				'.taskgraph/docs/prd.md'
			)
		]) {
			expect(plain(line).length).toBeLessThanOrEqual(80);
		}
	});
});
