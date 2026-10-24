import type { FastMCP } from 'fastmcp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	coreTools,
	getToolsConfiguration,
	registerTaskGraphTools,
	standardTools,
	toolRegistry
} from './tool-registry.js';

const ALL_COUNT = Object.keys(toolRegistry).length;

/** A server that records the names of the tools added to it */
function recordingServer() {
	const names: string[] = [];
	const server = {
		addTool: vi.fn((tool: { name: string }) => {
			names.push(tool.name);
		})
	} as unknown as FastMCP;
	return { server, names };
}

function register(toolMode?: string) {
	const { server, names } = recordingServer();
	const result = registerTaskGraphTools(server, toolMode);
	return { result, names };
}

describe('tool tiers', () => {
	it('core is the 7 daily tools, all in standard', () => {
		expect(coreTools).toEqual([
			'get_tasks',
			'next_task',
			'get_task',
			'set_task_status',
			'add_note',
			'parse_prd',
			'expand_task'
		]);
		expect(standardTools).toHaveLength(16);
		expect(standardTools).toEqual(expect.arrayContaining(coreTools));
	});

	it('every tier names only registered tools', () => {
		for (const tool of standardTools) {
			expect(typeof toolRegistry[tool]).toBe('function');
		}
		expect(standardTools.length).toBeLessThan(ALL_COUNT);
	});
});

describe('registerTaskGraphTools', () => {
	it('registers the core tools by default', () => {
		const { names, result } = register();

		expect(names).toHaveLength(coreTools.length);
		expect(result).toEqual({
			registeredTools: coreTools,
			failedTools: [],
			normalizedMode: 'core'
		});
	});

	it.each([
		['all', ALL_COUNT],
		['core', coreTools.length],
		['lean', coreTools.length],
		['CORE', coreTools.length],
		['standard', standardTools.length]
	])('registers tier %s (%i tools)', (mode, count) => {
		expect(register(mode).names).toHaveLength(count);
	});

	it('registers the tool each listed name means, once', () => {
		const { result } = register(
			' get_tasks , GET_TASK,get_tasks, response_language, next-task, add-tag '
		);

		expect(result.registeredTools).toEqual([
			'get_tasks',
			'get_task',
			'response-language',
			'next_task',
			'add_tag'
		]);
	});

	it.each([
		['an unknown tier', 'standart', ['"standart"']],
		[
			'a partly unknown list',
			'invalid_tool,get_tasks,fake_tool',
			['"invalid_tool"', '"fake_tool"']
		],
		[
			'an all-unknown list',
			'completely_invalid,nope',
			['"completely_invalid"', '"nope"']
		],
		['escape codes', 'bad\u001b[31m', ['"bad\\u001b[31m"']]
	])(
		'throws on %s, naming each unknown entry and the tiers',
		(_, mode, named) => {
			const { server, names } = recordingServer();

			let message = '';
			try {
				registerTaskGraphTools(server, mode);
			} catch (error) {
				message = (error as Error).message;
			}

			expect(message).toMatch(
				/^TASKGRAPH_TOOLS names unknown tiers or tools: /
			);
			for (const entry of named) expect(message).toContain(entry);
			expect(message).toContain('core, standard, all');
			expect(message).not.toContain('get_tasks"');
			expect(names).toEqual([]);
		}
	);

	it('throws on a list with no entries', () => {
		expect(() => register(',,,')).toThrow(
			/TASKGRAPH_TOOLS names no tools: ",,,"/
		);
	});

	it('counts a tool the server already has as registered', () => {
		const server = {
			addTool: vi.fn(() => {
				throw new Error('Tool get_tasks already registered');
			})
		} as unknown as FastMCP;

		const result = registerTaskGraphTools(server, 'get_tasks');

		expect(result.registeredTools).toEqual(['get_tasks']);
		expect(result.failedTools).toEqual([]);
	});

	it('reports a tool that fails to register', () => {
		const server = {
			addTool: vi.fn(() => {
				throw new Error('bad schema');
			})
		} as unknown as FastMCP;

		const result = registerTaskGraphTools(server, 'get_tasks,next_task');

		expect(result.registeredTools).toEqual([]);
		expect(result.failedTools).toEqual(['get_tasks', 'next_task']);
	});
});

describe('getToolsConfiguration', () => {
	const original = process.env.TASKGRAPH_TOOLS;
	afterEach(() => {
		if (original === undefined) delete process.env.TASKGRAPH_TOOLS;
		else process.env.TASKGRAPH_TOOLS = original;
	});

	it.each([undefined, '', '   '])("is 'core' for %j", (value) => {
		if (value === undefined) delete process.env.TASKGRAPH_TOOLS;
		else process.env.TASKGRAPH_TOOLS = value;

		expect(getToolsConfiguration()).toBe('core');
	});

	it('is TASKGRAPH_TOOLS trimmed', () => {
		process.env.TASKGRAPH_TOOLS = ' Standard ';

		expect(getToolsConfiguration()).toBe('Standard');
	});
});
