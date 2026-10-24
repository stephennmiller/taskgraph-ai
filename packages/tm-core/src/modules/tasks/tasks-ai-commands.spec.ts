/**
 * tmCore.tasks.generateObject passes AiConfig's reports to the caller's hooks
 */
import { describe, expect, it, vi } from 'vitest';
import type { ConfigManager } from '../config/managers/config-manager.js';
import type { TaskService } from './services/task-service.js';
import { TaskAiCommands } from './tasks-ai-commands.js';

const commands = (config: Record<string, unknown>) =>
	new TaskAiCommands(
		{} as TaskService,
		{
			getConfig: () => config,
			getConfigSources: () => [{ name: 'local', config }],
			getProjectRoot: () => '/project',
			getResponseLanguage: () => 'English',
			getActiveTag: () => 'master'
		} as unknown as ConfigManager
	);

describe('TaskAiCommands.generateObject', () => {
	it('sends debug lines to onDebug and rejects a call without a prompt', async () => {
		const onDebug = vi.fn();

		await expect(
			commands({ global: { debug: true } }).generateObject(
				{
					role: 'main',
					projectRoot: '/project',
					systemPrompt: 's',
					prompt: ''
				},
				{ onDebug }
			)
		).rejects.toThrow();

		expect(onDebug).toHaveBeenCalledWith(
			expect.stringContaining('generateObjectService called')
		);
	});
});
