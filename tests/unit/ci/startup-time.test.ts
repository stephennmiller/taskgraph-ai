import { describe, expect, it } from 'vitest';
import {
	BUDGETS,
	buildFixtureTasks,
	findHeavyImports,
	median
} from '../../../.github/scripts/check-startup-time.mjs';

describe('check-startup-time', () => {
	it('takes the middle sample, so one slow run cannot fail the check', () => {
		expect(median([120, 2000, 110])).toBe(120);
		expect(median([100, 300, 200, 4000])).toBe(250);
	});

	it('refuses to take the median of no samples', () => {
		expect(() => median([])).toThrow('median of no values');
	});

	it('builds a tagged tasks.json with the requested number of tasks', () => {
		const { master } = buildFixtureTasks(40);

		expect(master.tasks).toHaveLength(40);
		expect(master.tasks[0].dependencies).toEqual([]);
		expect(master.tasks[39]).toMatchObject({ id: 40, dependencies: [39] });
	});

	it('times next and show on task text with markdown and HTML, which would load a renderer (#836)', () => {
		const [task] = buildFixtureTasks(1).master.tasks;

		expect(BUDGETS.map(({ args }) => args.join(' '))).toEqual(
			expect.arrayContaining(['next', 'show 1'])
		);
		expect(task.description).toContain('`');
		expect(task.details).toMatch(/^- /m);
		expect(task.details).toMatch(/<p>/);
	});

	it('names the heavy packages and MCP server code a command loaded', () => {
		const nm = 'file:///repo/node_modules';
		const urls = [
			'file:///repo/dist/taskgraph.js',
			`${nm}/chalk/source/index.js`,
			`${nm}/zod/index.js`,
			`${nm}/ai/dist/index.mjs`,
			`${nm}/ai/dist/internal.mjs`,
			`${nm}/@ai-sdk/provider/dist/index.mjs`,
			`${nm}/marked-terminal/index.js`,
			`${nm}/ai-sdk-provider-claude-code/node_modules/zod/index.js`,
			'file:///repo/dist/mcp-server.js'
		];

		expect(findHeavyImports(urls)).toEqual([
			'@ai-sdk/provider',
			'ai',
			'dist/mcp-server.js',
			'marked-terminal'
		]);
	});

	it('does not mistake a package that shares a prefix for a heavy one', () => {
		const nm = 'file:///repo/node_modules';

		expect(
			findHeavyImports([
				`${nm}/aid/index.js`,
				`${nm}/markedly/index.js`,
				`${nm}/@ai-sdkx/core/index.js`
			])
		).toEqual([]);
	});
});
