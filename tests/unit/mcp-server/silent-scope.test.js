import { setTimeout as sleep } from 'node:timers/promises';
import {
	disableSilentMode,
	enableSilentMode,
	isSilentMode,
	withSilentScope
} from '../../../scripts/modules/utils.js';
import { scopeToolExecution } from '../../../mcp-server/src/tools/silent-scope.js';

describe('per-call silent mode', () => {
	afterEach(() => disableSilentMode());

	test('a fast call finishing does not un-silence a slow call', async () => {
		const seen = [];
		const slow = withSilentScope(async () => {
			enableSilentMode();
			await sleep(30);
			seen.push(isSilentMode());
		});
		const fast = withSilentScope(async () => {
			enableSilentMode();
			await sleep(5);
			disableSilentMode();
		});

		await Promise.all([slow, fast]);

		expect(seen).toEqual([true]);
	});

	test('a scope does not change silent mode outside it', async () => {
		await withSilentScope(async () => {
			enableSilentMode();
			await sleep(1);
		});

		expect(isSilentMode()).toBe(false);
	});

	test('a scope starts silent when the global switch is already on', () => {
		enableSilentMode();

		const inside = withSilentScope(() => isSilentMode());

		expect(inside).toBe(true);
	});

	test('outside any scope the global switch still works', () => {
		enableSilentMode();
		expect(isSilentMode()).toBe(true);
		disableSilentMode();
		expect(isSilentMode()).toBe(false);
	});
});

describe('scopeToolExecution', () => {
	test('runs every tool in its own scope and keeps other server methods', async () => {
		const added = [];
		const server = {
			addTool: (tool) => added.push(tool),
			name: 'srv',
			ping() {
				return this.name;
			}
		};
		const scoped = scopeToolExecution(server);
		const seen = [];
		const tool = (id, ms) => ({
			name: id,
			execute: async () => {
				enableSilentMode();
				await sleep(ms);
				seen.push([id, isSilentMode()]);
				disableSilentMode();
				return id;
			}
		});

		scoped.addTool(tool('slow', 30));
		scoped.addTool(tool('fast', 5));
		const results = await Promise.all(added.map((t) => t.execute()));

		expect(results).toEqual(['slow', 'fast']);
		expect(seen).toEqual([
			['fast', true],
			['slow', true]
		]);
		expect(scoped.ping()).toBe('srv');
		expect(isSilentMode()).toBe(false);
	});
});
