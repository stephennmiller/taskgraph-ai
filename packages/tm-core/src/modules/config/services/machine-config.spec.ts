import { describe, expect, it } from 'vitest';
import {
	hasPerMachineSettings,
	mergeMachineConfig,
	splitMachineConfig
} from './machine-config.js';

const EXECUTABLE = '/opt/claude/bin/claude';

describe('mergeMachineConfig', () => {
	it('lets config.local.json override config.json key by key', () => {
		const shared = {
			models: { main: { modelId: 'sonnet', maxTokens: 64000 } },
			global: { logLevel: 'info' }
		};
		const local = {
			models: { main: { modelId: 'opus' } },
			claudeCode: { pathToClaudeCodeExecutable: EXECUTABLE }
		};

		const merged = mergeMachineConfig(shared, local);

		expect(merged).toEqual({
			models: { main: { modelId: 'opus', maxTokens: 64000 } },
			global: { logLevel: 'info' },
			claudeCode: { pathToClaudeCodeExecutable: EXECUTABLE }
		});
	});

	it('returns config.json unchanged when there is no local file', () => {
		const shared = { global: { logLevel: 'info' } };

		expect(mergeMachineConfig(shared, null)).toEqual(shared);
		expect(mergeMachineConfig(shared, undefined)).toEqual(shared);
	});

	it('replaces arrays instead of merging them', () => {
		const merged = mergeMachineConfig(
			{ claudeCode: { allowedTools: ['Read', 'Grep'] } },
			{ claudeCode: { allowedTools: ['Read'] } }
		);

		expect(merged).toEqual({ claudeCode: { allowedTools: ['Read'] } });
	});

	it('does not change its inputs', () => {
		const shared = { models: { main: { modelId: 'sonnet' } } };
		const local = { models: { main: { modelId: 'opus' } } };

		mergeMachineConfig(shared, local);

		expect(shared.models.main.modelId).toBe('sonnet');
		expect(local.models.main.modelId).toBe('opus');
	});
});

describe('splitMachineConfig', () => {
	it('moves the claude executable path out of config.json', () => {
		const config = {
			models: { main: { modelId: 'sonnet' } },
			claudeCode: { pathToClaudeCodeExecutable: EXECUTABLE }
		};

		const { shared, local } = splitMachineConfig(config, config, null);

		expect(shared).toEqual({ models: { main: { modelId: 'sonnet' } } });
		expect(local).toEqual({
			claudeCode: { pathToClaudeCodeExecutable: EXECUTABLE }
		});
	});

	it('keeps other claudeCode settings in config.json', () => {
		const config = {
			claudeCode: { maxTurns: 5, pathToClaudeCodeExecutable: EXECUTABLE }
		};

		const { shared, local } = splitMachineConfig(config, config, null);

		expect(shared).toEqual({ claudeCode: { maxTurns: 5 } });
		expect(local).toEqual({
			claudeCode: { pathToClaudeCodeExecutable: EXECUTABLE }
		});
	});

	it('saves a changed local override locally and leaves config.json as it was', () => {
		const currentShared = { models: { main: { modelId: 'sonnet' } } };
		const currentLocal = { models: { main: { modelId: 'opus' } } };
		const config = { models: { main: { modelId: 'haiku' } } };

		const { shared, local } = splitMachineConfig(
			config,
			currentShared,
			currentLocal
		);

		expect(shared).toEqual({ models: { main: { modelId: 'sonnet' } } });
		expect(local).toEqual({ models: { main: { modelId: 'haiku' } } });
	});

	it('keeps every changed key of a locally overridden model role local', () => {
		// models --set-main haiku with main overridden locally: setModel also
		// changes maxTokens, which must not reach the shared file
		const currentShared = {
			models: {
				main: { modelId: 'sonnet', maxTokens: 64000, temperature: 0.2 },
				research: { modelId: 'sonnet', maxTokens: 8700 }
			}
		};
		const currentLocal = { models: { main: { modelId: 'opus' } } };
		const config = {
			models: {
				main: { modelId: 'haiku', maxTokens: 32000, temperature: 0.2 },
				research: { modelId: 'opus', maxTokens: 8700 }
			}
		};

		const { shared, local } = splitMachineConfig(
			config,
			currentShared,
			currentLocal
		);

		expect(shared).toEqual({
			models: {
				main: { modelId: 'sonnet', maxTokens: 64000, temperature: 0.2 },
				research: { modelId: 'opus', maxTokens: 8700 }
			}
		});
		expect(local).toEqual({
			models: { main: { modelId: 'haiku', maxTokens: 32000 } }
		});
	});

	it('keeps defaults config.json leaves out from being pinned in config.local.json', () => {
		// config.json saves only non-default keys, so its main role has no
		// maxTokens or temperature; the merged config has the defaults
		const defaults = {
			models: {
				main: { modelId: 'sonnet', maxTokens: 64000, temperature: 0.2 }
			}
		};
		const currentShared = { models: { main: { modelId: 'sonnet' } } };
		const currentLocal = { models: { main: { modelId: 'opus' } } };
		const config = {
			models: { main: { modelId: 'opus', maxTokens: 64000, temperature: 0.2 } }
		};

		const { shared, local } = splitMachineConfig(
			config,
			currentShared,
			currentLocal,
			defaults
		);

		expect(local).toEqual({ models: { main: { modelId: 'opus' } } });
		expect(shared).toEqual({ models: { main: { modelId: 'sonnet' } } });
	});

	it('leaves a key out of config.json when only the local file had it', () => {
		const config = {
			global: { logLevel: 'info' },
			claudeCode: { maxTurns: 3 }
		};

		const { shared } = splitMachineConfig(
			config,
			{ global: { logLevel: 'info' } },
			{ claudeCode: { maxTurns: 3 } }
		);

		expect(shared).toEqual({ global: { logLevel: 'info' } });
	});

	it('writes everything to config.json when nothing is per-machine', () => {
		const config = { models: { main: { modelId: 'opus' } } };

		const { shared, local } = splitMachineConfig(config, null, null);

		expect(shared).toEqual(config);
		expect(local).toEqual({});
	});

	it('round-trips with mergeMachineConfig', () => {
		const currentShared = {
			models: { main: { modelId: 'sonnet' } },
			claudeCode: { maxTurns: 5 }
		};
		const currentLocal = {
			claudeCode: { pathToClaudeCodeExecutable: EXECUTABLE }
		};

		const merged = mergeMachineConfig(currentShared, currentLocal);
		const { shared, local } = splitMachineConfig(
			merged,
			currentShared,
			currentLocal
		);

		expect(shared).toEqual(currentShared);
		expect(local).toEqual(currentLocal);
	});
});

describe('hasPerMachineSettings', () => {
	it('is true when config.json holds the claude executable path', () => {
		expect(
			hasPerMachineSettings({
				claudeCode: { pathToClaudeCodeExecutable: EXECUTABLE }
			})
		).toBe(true);
	});

	it('is false for shared settings only, or no config', () => {
		expect(hasPerMachineSettings({ claudeCode: { maxTurns: 5 } })).toBe(false);
		expect(hasPerMachineSettings(null)).toBe(false);
	});
});

describe('__proto__ and constructor keys in a config file', () => {
	it('are skipped when merging', () => {
		const local = JSON.parse('{"__proto__":{"polluted":"yes"},"a":2}');

		const merged = mergeMachineConfig({ a: 1 }, local) as Record<
			string,
			unknown
		>;

		expect(merged).toEqual({ a: 2 });
		expect(merged.polluted).toBeUndefined();
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
	});

	it('are skipped when splitting, so Object.prototype stays unchanged', () => {
		const shared = JSON.parse('{"__proto__":{"polluted":"shared"}}');
		const local = JSON.parse(
			'{"__proto__":{"polluted":"local"},"constructor":{"prototype":{"x":1}}}'
		);

		splitMachineConfig({ a: 1 }, shared, local);

		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
		expect(({} as Record<string, unknown>).x).toBeUndefined();
	});
});
