import inquirer from 'inquirer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectClarifications } from './clarify-prompts.js';

const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');

const QUESTIONS = [
	{
		question: 'Which database should the app use?',
		suggestedAnswer: 'PostgreSQL 16'
	},
	{ question: 'How do users sign in?', suggestedAnswer: 'Email and password' }
];

/** Answer the prompts in order */
function answerWith(...answers: Array<string | Error>) {
	const prompt = vi.fn();
	for (const answer of answers) {
		if (answer instanceof Error) prompt.mockRejectedValueOnce(answer);
		else prompt.mockResolvedValueOnce({ answer });
	}
	vi.spyOn(inquirer, 'createPromptModule').mockReturnValue(prompt as never);
	return prompt;
}

function ctrlC() {
	const error = new Error('User force closed the prompt with SIGINT');
	error.name = 'ExitPromptError';
	return error;
}

describe('collectClarifications', () => {
	let log: ReturnType<typeof vi.spyOn>;
	const printed = () =>
		log.mock.calls.map((call: unknown[]) => plain(String(call[0])));

	beforeEach(() => {
		log = vi.spyOn(console, 'log').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('starts each question on its suggested answer, so Enter accepts it', async () => {
		const prompt = answerWith('PostgreSQL 16', 'Magic links');

		const answers = await collectClarifications(QUESTIONS, {
			prdName: 'prd.md',
			interactive: true
		});

		expect(inquirer.createPromptModule).toHaveBeenCalledWith({
			clearPromptOnDone: true
		});
		expect(prompt.mock.calls[0][0][0]).toMatchObject({
			type: 'input',
			message: 'Which database should the app use?',
			default: 'PostgreSQL 16'
		});
		expect(answers).toEqual([
			{
				question: 'Which database should the app use?',
				answer: 'PostgreSQL 16'
			},
			{ question: 'How do users sign in?', answer: 'Magic links' }
		]);
		expect(printed()).toEqual([
			'2 questions about prd.md · Enter keeps the suggested answer',
			'✔ Which database should the app use? PostgreSQL 16',
			'✔ How do users sign in? Magic links'
		]);
	});

	it('returns null on Ctrl-C', async () => {
		answerWith('PostgreSQL 16', ctrlC());

		const answers = await collectClarifications(QUESTIONS, {
			prdName: 'prd.md',
			interactive: true
		});

		expect(answers).toBeNull();
	});

	it('takes the suggested answers without a terminal and says so once', async () => {
		const spy = vi.spyOn(inquirer, 'createPromptModule');

		const answers = await collectClarifications(QUESTIONS, {
			prdName: 'prd.md',
			interactive: false
		});

		expect(spy).not.toHaveBeenCalled();
		expect(answers).toEqual([
			{
				question: 'Which database should the app use?',
				answer: 'PostgreSQL 16'
			},
			{ question: 'How do users sign in?', answer: 'Email and password' }
		]);
		expect(printed()).toEqual([
			'Accepted the suggested answers to 2 questions (no terminal to ask in)'
		]);
	});

	it('takes the suggested answers with --yes even in a terminal', async () => {
		const spy = vi.spyOn(inquirer, 'createPromptModule');

		await collectClarifications(QUESTIONS, {
			prdName: 'prd.md',
			yes: true,
			interactive: true
		});

		expect(spy).not.toHaveBeenCalled();
		expect(printed()).toEqual([
			'Accepted the suggested answers to 2 questions (--yes)'
		]);
	});

	it('asks nothing and prints nothing when there are no questions', async () => {
		const spy = vi.spyOn(inquirer, 'createPromptModule');

		expect(
			await collectClarifications([], { prdName: 'prd.md', interactive: true })
		).toEqual([]);
		expect(spy).not.toHaveBeenCalled();
		expect(log).not.toHaveBeenCalled();
	});
});
