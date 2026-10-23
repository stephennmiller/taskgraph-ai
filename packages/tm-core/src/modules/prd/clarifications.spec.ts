import { describe, expect, it } from 'vitest';
import {
	acceptSuggestedAnswers,
	applyClarifications,
	MAX_CLARIFYING_QUESTIONS,
	normalizeClarifyingQuestions,
	parseClarificationAnswers,
	readClarifications
} from './clarifications.js';

const PRD = ['# Bookmarks', '', 'Save links and tag them.', ''].join('\n');

const DB = {
	question: 'Which database should the app use?',
	answer: 'PostgreSQL 16'
};
const AUTH = {
	question: 'How do users sign in?',
	answer: 'Email and password'
};

describe('applyClarifications', () => {
	it('adds a Clarifications section at the end of a PRD that has none', () => {
		const result = applyClarifications(PRD, [DB, AUTH]);

		expect(result.content).toBe(
			[
				'# Bookmarks',
				'',
				'Save links and tag them.',
				'',
				'## Clarifications',
				'',
				'- **Q:** Which database should the app use?',
				'  **A:** PostgreSQL 16',
				'- **Q:** How do users sign in?',
				'  **A:** Email and password',
				''
			].join('\n')
		);
		expect(result).toMatchObject({
			added: 2,
			updated: 0,
			unchanged: 0,
			createdSection: true,
			changed: true
		});
	});

	it('appends to an existing Clarifications heading, before the next section', () => {
		const prd = [
			'# Bookmarks',
			'',
			'## Clarifications',
			'',
			'- **Q:** Which database should the app use?',
			'  **A:** PostgreSQL 16',
			'',
			'## Scope',
			'',
			'Web only.'
		].join('\n');

		const result = applyClarifications(prd, [DB, AUTH]);

		expect(result.content).toBe(
			[
				'# Bookmarks',
				'',
				'## Clarifications',
				'',
				'- **Q:** Which database should the app use?',
				'  **A:** PostgreSQL 16',
				'- **Q:** How do users sign in?',
				'  **A:** Email and password',
				'',
				'## Scope',
				'',
				'Web only.'
			].join('\n')
		);
		expect(result).toMatchObject({ added: 1, unchanged: 1 });
		expect(result.createdSection).toBe(false);
	});

	it('starts the list after a blank line when the heading has only prose under it', () => {
		const prd = '# App\n\n## Clarifications\n\nDecided in review.\n';

		const result = applyClarifications(prd, [AUTH]);

		expect(result.content).toBe(
			[
				'# App',
				'',
				'## Clarifications',
				'',
				'Decided in review.',
				'',
				'- **Q:** How do users sign in?',
				'  **A:** Email and password',
				''
			].join('\n')
		);
	});

	it('is idempotent: writing the same answers again changes nothing', () => {
		const once = applyClarifications(PRD, [DB, AUTH]).content;

		const twice = applyClarifications(once, [
			{ ...DB, question: 'which database should the app use' },
			AUTH
		]);

		expect(twice.content).toBe(once);
		expect(twice).toMatchObject({ added: 0, unchanged: 2, changed: false });
	});

	it('replaces the answer when the same question is answered differently', () => {
		const once = applyClarifications(PRD, [DB]).content;

		const result = applyClarifications(once, [{ ...DB, answer: 'SQLite' }]);

		expect(readClarifications(result.content)).toEqual([
			{ question: DB.question, answer: 'SQLite' }
		]);
		expect(result).toMatchObject({ added: 0, updated: 1, changed: true });
	});

	it('keeps answers on one line and skips duplicates and blanks', () => {
		const result = applyClarifications(PRD, [
			{
				question: 'Which  database\nshould the app use?',
				answer: 'Postgres\n16'
			},
			DB,
			{ question: 'Empty?', answer: '  ' }
		]);

		expect(readClarifications(result.content)).toEqual([
			{ question: 'Which database should the app use?', answer: 'Postgres 16' }
		]);
	});

	it('keeps Windows line endings', () => {
		const result = applyClarifications('# App\r\n\r\nText.\r\n', [DB]);

		expect(result.content).toContain('\r\n## Clarifications\r\n');
		expect(result.content).not.toMatch(/[^\r]\n/);
	});

	it('changes nothing when there are no answers', () => {
		expect(applyClarifications(PRD, [])).toMatchObject({
			content: PRD,
			changed: false
		});
	});
});

describe('normalizeClarifyingQuestions', () => {
	it('drops questions the PRD already answers, duplicates and blanks, and caps the count', () => {
		const prd = applyClarifications(PRD, [DB]).content;
		const asked = [
			{ question: DB.question, suggestedAnswer: 'MySQL' },
			{ question: ' How do users\nsign in? ', suggestedAnswer: 'Email' },
			{ question: 'how do users sign in', suggestedAnswer: 'SSO' },
			{ question: '', suggestedAnswer: 'x' },
			...Array.from({ length: 8 }, (_, i) => ({
				question: `Question ${i}?`,
				suggestedAnswer: `Answer ${i}`
			}))
		];

		const questions = normalizeClarifyingQuestions(asked, prd);

		expect(questions).toHaveLength(MAX_CLARIFYING_QUESTIONS);
		expect(questions[0]).toEqual({
			question: 'How do users sign in?',
			suggestedAnswer: 'Email'
		});
		expect(questions.map((q) => q.question)).not.toContain(DB.question);
	});
});

describe('acceptSuggestedAnswers', () => {
	it('answers each question with its suggestion', () => {
		expect(
			acceptSuggestedAnswers([
				{ question: DB.question, suggestedAnswer: 'PostgreSQL 16' }
			])
		).toEqual([DB]);
	});
});

describe('parseClarificationAnswers', () => {
	it('takes the --clarify --json output, using the suggestion where no answer was given', () => {
		const answers = parseClarificationAnswers({
			prd: 'prd.md',
			questions: [
				{
					question: DB.question,
					suggestedAnswer: 'MySQL',
					answer: 'PostgreSQL 16'
				},
				{ question: AUTH.question, suggestedAnswer: 'Email and password' }
			]
		});

		expect(answers).toEqual([DB, AUTH]);
	});

	it('takes a plain list of question and answer pairs', () => {
		expect(parseClarificationAnswers([DB])).toEqual([DB]);
	});

	it('says which entry is wrong', () => {
		expect(() => parseClarificationAnswers('nope')).toThrow(
			'Answers must be a list'
		);
		expect(() => parseClarificationAnswers([{ answer: 'x' }])).toThrow(
			'Answer 1 has no "question"'
		);
		expect(() => parseClarificationAnswers([{ question: 'Why?' }])).toThrow(
			'"Why?" has no "answer"'
		);
	});
});
