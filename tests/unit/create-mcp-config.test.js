/**
 * Tests that generated MCP configs launch this package under the taskgraph-ai
 * key, while configs written by earlier task-master-ai installs are still
 * recognised (left alone on setup, cleaned up on removal).
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
	removeTaskMasterMCPConfiguration,
	setupMCPConfiguration
} from '../../src/utils/create-mcp-config.js';

const MCP_PATH = '.cursor/mcp.json';

describe('create-mcp-config', () => {
	let projectRoot;
	const readConfig = () =>
		JSON.parse(fs.readFileSync(path.join(projectRoot, MCP_PATH), 'utf8'));
	const writeConfig = (config) => {
		fs.mkdirSync(path.join(projectRoot, '.cursor'), { recursive: true });
		fs.writeFileSync(path.join(projectRoot, MCP_PATH), JSON.stringify(config));
	};

	beforeEach(() => {
		projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-mcp-config-'));
	});

	afterEach(() => {
		fs.rmSync(projectRoot, { recursive: true, force: true });
	});

	describe('setupMCPConfiguration', () => {
		test('creates a taskgraph-ai server that runs the taskgraph-ai package', () => {
			setupMCPConfiguration(projectRoot, MCP_PATH);

			const servers = readConfig().mcpServers;
			expect(Object.keys(servers)).toEqual(['taskgraph-ai']);
			expect(servers['taskgraph-ai'].args).toEqual(['-y', 'taskgraph-ai']);
		});

		test('adds taskgraph-ai next to unrelated servers', () => {
			writeConfig({ mcpServers: { other: { command: 'x', args: ['y'] } } });

			setupMCPConfiguration(projectRoot, MCP_PATH);

			expect(Object.keys(readConfig().mcpServers).sort()).toEqual([
				'other',
				'taskgraph-ai'
			]);
		});

		test('leaves an existing task-master-ai install untouched', () => {
			const legacy = {
				mcpServers: {
					'task-master-ai': { command: 'npx', args: ['-y', 'task-master-ai'] }
				}
			};
			writeConfig(legacy);

			setupMCPConfiguration(projectRoot, MCP_PATH);

			expect(readConfig()).toEqual(legacy);
		});

		test('leaves an existing taskgraph-ai install untouched', () => {
			const current = {
				mcpServers: {
					'taskgraph-ai': { command: 'npx', args: ['-y', 'taskgraph-ai'] }
				}
			};
			writeConfig(current);

			setupMCPConfiguration(projectRoot, MCP_PATH);

			expect(readConfig()).toEqual(current);
		});
	});

	describe('removeTaskMasterMCPConfiguration', () => {
		test.each([
			['taskgraph-ai', 'taskgraph-ai'],
			['task-master-ai', 'task-master-ai']
		])('removes a %s server and keeps the others', (key, pkg) => {
			writeConfig({
				mcpServers: {
					[key]: { command: 'npx', args: ['-y', pkg] },
					other: { command: 'x', args: ['y'] }
				}
			});

			const result = removeTaskMasterMCPConfiguration(projectRoot, MCP_PATH);

			expect(result.removed).toBe(true);
			expect(Object.keys(readConfig().mcpServers)).toEqual(['other']);
		});

		test('removes a renamed server that launches either package', () => {
			writeConfig({
				mcpServers: {
					a: { command: 'npx', args: ['-y', 'taskgraph-ai'] },
					b: { command: 'npx', args: ['-y', 'task-master-ai'] },
					other: { command: 'x', args: ['y'] }
				}
			});

			removeTaskMasterMCPConfiguration(projectRoot, MCP_PATH);

			expect(Object.keys(readConfig().mcpServers)).toEqual(['other']);
		});
	});
});
