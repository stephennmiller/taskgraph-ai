/**
 * @fileoverview Tests for the models and response-language MCP tools.
 * tm-core is faked at the createTmCore boundary; everything else is real.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const config = {
	getModelConfiguration: vi.fn(),
	getAvailableModelsList: vi.fn(),
	setModel: vi.fn(),
	setResponseLanguage: vi.fn()
};

vi.mock('@tm/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tm/core')>()),
	createTmCore: vi.fn(async () => ({ config }))
}));

import {
	registerModelsTool,
	registerResponseLanguageTool
} from './settings.tool.js';

type Tool = {
	execute: (args: Record<string, unknown>, ctx: unknown) => Promise<any>;
};

function register(fn: (server: any) => void): Tool {
	const registered: Tool[] = [];
	fn({ addTool: (tool: Tool) => registered.push(tool) });
	return registered[0];
}

const ctx = {
	log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
	session: undefined
};
const projectRoot = process.cwd();
const ok = (data: unknown) => ({ success: true, data });

beforeEach(() => vi.clearAllMocks());

describe('models', () => {
	it('lists models, sets the first role given, or shows the configuration', async () => {
		const tool = register(registerModelsTool);
		config.getAvailableModelsList.mockReturnValue(ok({ models: [] }));
		config.setModel.mockReturnValue(ok({ role: 'research' }));
		config.getModelConfiguration.mockReturnValue(ok({ activeModels: {} }));

		await tool.execute({ projectRoot, listAvailableModels: true }, ctx);
		await tool.execute(
			{ projectRoot, setResearch: 'opus', setFallback: 'haiku' },
			ctx
		);
		const shown = await tool.execute({ projectRoot }, ctx);

		expect(config.getAvailableModelsList).toHaveBeenCalledTimes(1);
		expect(config.setModel).toHaveBeenCalledWith('research', 'opus');
		expect(config.setModel).toHaveBeenCalledTimes(1);
		expect(JSON.parse(shown.content[0].text).data).toEqual({
			activeModels: {}
		});
	});

	it('replies with the error a missing config throws', async () => {
		config.getModelConfiguration.mockImplementation(() => {
			throw new Error('The configuration file is missing.');
		});

		const result = await register(registerModelsTool).execute(
			{ projectRoot },
			ctx
		);

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain(
			'Error: The configuration file is missing.'
		);
	});
});

describe('response-language', () => {
	it('sets the language and replies with a refusal as an error', async () => {
		const tool = register(registerResponseLanguageTool);
		config.setResponseLanguage
			.mockReturnValueOnce(ok({ responseLanguage: 'German' }))
			.mockReturnValueOnce({
				success: false,
				error: { code: 'INVALID_RESPONSE_LANGUAGE', message: 'Invalid' }
			});

		const set = await tool.execute({ projectRoot, language: 'German' }, ctx);
		const refused = await tool.execute({ projectRoot, language: ' ' }, ctx);

		expect(JSON.parse(set.content[0].text).data.responseLanguage).toBe(
			'German'
		);
		expect(refused.isError).toBe(true);
	});
});
