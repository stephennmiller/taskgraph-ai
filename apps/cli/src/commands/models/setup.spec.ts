import inquirer from 'inquirer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runInteractiveSetup } from './setup.js';

const settings = {
	getModelConfiguration: vi.fn(),
	setModel: vi.fn()
};

const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');

/** Answer the three prompts in order: main, research, fallback */
function answerWith(...answers: Array<string | Error>) {
	const prompt = vi.fn();
	for (const answer of answers) {
		if (answer instanceof Error) prompt.mockRejectedValueOnce(answer);
		else prompt.mockResolvedValueOnce({ model: answer });
	}
	vi.spyOn(inquirer, 'createPromptModule').mockReturnValue(prompt as never);
	return prompt;
}

function ctrlC() {
	const error = new Error('User force closed the prompt with SIGINT');
	error.name = 'ExitPromptError';
	return error;
}

describe('runInteractiveSetup', () => {
	let log: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		vi.clearAllMocks();
		settings.getModelConfiguration.mockReturnValue({
			success: true,
			data: {
				activeModels: {
					main: {
						provider: 'claude-code',
						modelId: 'sonnet',
						sweScore: null,
						cost: null
					},
					research: {
						provider: 'claude-code',
						modelId: 'sonnet',
						sweScore: null,
						cost: null
					},
					fallback: {
						provider: 'claude-code',
						modelId: 'haiku',
						sweScore: null,
						cost: null
					}
				},
				message: ''
			}
		});
		settings.setModel.mockReturnValue({ success: true });
		log = vi.spyOn(console, 'log').mockImplementation(() => {});
		process.exitCode = undefined;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		process.exitCode = undefined;
	});

	it('starts each prompt on the current model', async () => {
		const prompt = answerWith('sonnet', 'sonnet', 'haiku');

		await runInteractiveSetup(settings as never);

		const defaults = prompt.mock.calls.map(
			([questions]) =>
				(questions as unknown as Array<{ default: string }>)[0].default
		);
		expect(defaults).toEqual(['sonnet', 'sonnet', 'haiku']);
	});

	it('saves only the roles that changed', async () => {
		answerWith('opus', 'sonnet', 'haiku');

		const ok = await runInteractiveSetup(settings as never);

		expect(ok).toBe(true);
		expect(settings.setModel).toHaveBeenCalledTimes(1);
		expect(settings.setModel).toHaveBeenCalledWith('main', 'opus');
		expect(plain(String(log.mock.calls.at(-1)?.[0]))).toContain(
			'Main model  sonnet → opus'
		);
	});

	it('saves nothing and adds nothing when every answer is the current model', async () => {
		answerWith('sonnet', 'sonnet', 'haiku');

		await runInteractiveSetup(settings as never);

		expect(settings.setModel).not.toHaveBeenCalled();
		const printed = log.mock.calls.map((call: unknown[]) =>
			plain(String(call[0]))
		);
		expect(printed).toEqual([
			'✔ Main model (creates and updates tasks) sonnet',
			'✔ Research model (research and --research runs) sonnet',
			'✔ Fallback model (used if the main model fails) haiku'
		]);
	});

	it('clears each list when its prompt ends, so Ctrl-C leaves nothing behind', async () => {
		answerWith('opus', ctrlC());

		await runInteractiveSetup(settings as never);

		expect(inquirer.createPromptModule).toHaveBeenCalledWith({
			clearPromptOnDone: true
		});
		const printed = log.mock.calls.map((call: unknown[]) =>
			plain(String(call[0]))
		);
		expect(printed).toEqual([
			'✔ Main model (creates and updates tasks) opus',
			'\nCancelled; no models changed'
		]);
	});

	it('saves nothing when Ctrl-C is pressed part way through', async () => {
		answerWith('opus', ctrlC());

		const ok = await runInteractiveSetup(settings as never);

		expect(ok).toBe(false);
		expect(process.exitCode).toBe(130);
		expect(settings.setModel).not.toHaveBeenCalled();
	});

	it('exits 1 when a model cannot be saved', async () => {
		answerWith('opus', 'opus', 'haiku');
		settings.setModel.mockReturnValueOnce({
			success: false,
			error: { code: 'CONFIG_WRITE_ERROR', message: 'disk full' }
		});
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});

		const ok = await runInteractiveSetup(settings as never);

		expect(ok).toBe(false);
		expect(process.exitCode).toBe(1);
		expect(plain(String(error.mock.calls[0]?.[0]))).toContain(
			"Couldn't set the main model: disk full"
		);
	});
});
