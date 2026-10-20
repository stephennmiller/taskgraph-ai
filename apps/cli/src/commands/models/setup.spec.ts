import inquirer from 'inquirer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as modelManagement from '../../lib/model-management.js';
import { runInteractiveSetup } from './setup.js';

vi.mock('../../lib/model-management.js', () => ({
	getAvailableModels: vi.fn(),
	getModelConfiguration: vi.fn(),
	setModel: vi.fn()
}));

const MODELS = ['opus', 'sonnet', 'haiku'].map((id) => ({
	id,
	provider: 'claude-code',
	allowed_roles: ['main', 'research', 'fallback']
}));

const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');

/** Answer the three prompts in order: main, research, fallback */
function answerWith(...answers: Array<string | Error>) {
	const prompt = vi.spyOn(inquirer, 'prompt');
	for (const answer of answers) {
		if (answer instanceof Error) prompt.mockRejectedValueOnce(answer);
		else prompt.mockResolvedValueOnce({ model: answer } as never);
	}
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
		vi.mocked(modelManagement.getAvailableModels).mockReturnValue(MODELS);
		vi.mocked(modelManagement.getModelConfiguration).mockResolvedValue({
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
		vi.mocked(modelManagement.setModel).mockResolvedValue({ success: true });
		log = vi.spyOn(console, 'log').mockImplementation(() => {});
		process.exitCode = undefined;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		process.exitCode = undefined;
	});

	it('starts each prompt on the current model', async () => {
		const prompt = answerWith('sonnet', 'sonnet', 'haiku');

		await runInteractiveSetup('/project');

		const defaults = prompt.mock.calls.map(
			([questions]) =>
				(questions as unknown as Array<{ default: string }>)[0].default
		);
		expect(defaults).toEqual(['sonnet', 'sonnet', 'haiku']);
	});

	it('saves only the roles that changed', async () => {
		answerWith('opus', 'sonnet', 'haiku');

		const ok = await runInteractiveSetup('/project');

		expect(ok).toBe(true);
		expect(modelManagement.setModel).toHaveBeenCalledTimes(1);
		expect(modelManagement.setModel).toHaveBeenCalledWith('main', 'opus', {
			projectRoot: '/project'
		});
		expect(plain(String(log.mock.calls.at(-1)?.[0]))).toContain(
			'Main model  sonnet → opus'
		);
	});

	it('saves nothing when every answer is the current model', async () => {
		answerWith('sonnet', 'sonnet', 'haiku');

		await runInteractiveSetup('/project');

		expect(modelManagement.setModel).not.toHaveBeenCalled();
		expect(plain(String(log.mock.calls.at(-1)?.[0]))).toContain(
			'Models unchanged'
		);
	});

	it('saves nothing when Ctrl-C is pressed part way through', async () => {
		answerWith('opus', ctrlC());

		const ok = await runInteractiveSetup('/project');

		expect(ok).toBe(false);
		expect(process.exitCode).toBe(130);
		expect(modelManagement.setModel).not.toHaveBeenCalled();
	});

	it('exits 1 when a model cannot be saved', async () => {
		answerWith('opus', 'opus', 'haiku');
		vi.mocked(modelManagement.setModel).mockResolvedValueOnce({
			success: false,
			error: { code: 'CONFIG_WRITE_ERROR', message: 'disk full' }
		});
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});

		const ok = await runInteractiveSetup('/project');

		expect(ok).toBe(false);
		expect(process.exitCode).toBe(1);
		expect(plain(String(error.mock.calls[0]?.[0]))).toContain(
			"Couldn't set the main model: disk full"
		);
	});
});
