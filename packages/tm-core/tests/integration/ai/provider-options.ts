import { vi } from 'vitest';
import type { ClaudeCodeProviderOptions } from '../../../src/index.js';

/** What the legacy CLI passes in: its logger, config settings and model list */
export const providerOptions = (): ClaudeCodeProviderOptions => ({
	log: vi.fn(),
	getSettingsForCommand: () => ({}),
	supportedModels: ['opus', 'sonnet', 'haiku']
});
