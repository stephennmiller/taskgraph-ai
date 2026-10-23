/**
 * Helpers for testing the legacy MCP tools in mcp-server/src/tools/ against
 * the real @tm/mcp wrappers, with a temp project on disk.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { vi } from 'vitest';

/** Runs a tool's register function and returns the tool it adds. */
export function registerTool(register) {
	let tool;
	register({
		addTool: (config) => {
			tool = config;
		}
	});
	return tool;
}

/**
 * Creates a project with an empty tasks.json, and a state.json when
 * currentTag is given. Returns its real path.
 */
export function createProject({ currentTag } = {}) {
	const root = fs.realpathSync(
		fs.mkdtempSync(path.join(os.tmpdir(), 'tg-mcp-tool-'))
	);
	const tasksDir = path.join(root, '.taskgraph', 'tasks');
	fs.mkdirSync(tasksDir, { recursive: true });
	fs.writeFileSync(
		path.join(tasksDir, 'tasks.json'),
		JSON.stringify({ master: { tasks: [] } })
	);
	if (currentTag) {
		fs.writeFileSync(
			path.join(root, '.taskgraph', 'state.json'),
			JSON.stringify({ currentTag })
		);
	}
	return root;
}

export const removeProject = (root) =>
	fs.rmSync(root, { recursive: true, force: true });

export const tasksJsonPathOf = (root) =>
	path.join(root, '.taskgraph', 'tasks', 'tasks.json');

export const createLog = () => ({
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	debug: vi.fn()
});

/** The text of an MCP tool response. */
export const responseText = (response) => response.content[0].text;
