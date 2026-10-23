/**
 * @fileoverview Regression tests for #292: tools called with a tag that is not
 * the current one changed that tag but replied `"tag": "master"`. Each call
 * goes through the built server; a guard test checks that every tool that
 * resolves a tag passes it to the reply.
 *
 * Needs the build (`npm run build`).
 *
 * @integration
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTask, createTasksFile } from '@tm/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { callMCPTool } from '../../helpers/call-mcp-tool.js';

const repoRoot = path.resolve(__dirname, '../../../../..');

describe('replies name the tag the tool worked in (#292)', () => {
	let testDir: string;
	let tasksPath: string;

	const readTag = (tag: string) =>
		JSON.parse(fs.readFileSync(tasksPath, 'utf8'))[tag].tasks;

	beforeEach(() => {
		testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-mcp-tag-'));
		process.chdir(testDir);
		execSync(
			`node "${path.join(repoRoot, 'dist', 'taskgraph.js')}" init --yes`,
			{
				stdio: 'pipe',
				env: { ...process.env, TASKGRAPH_SKIP_AUTO_UPDATE: '1' }
			}
		);
		tasksPath = path.join(testDir, '.taskgraph', 'tasks', 'tasks.json');
		const tasks = [
			createTask({ id: 1, title: 'One' }),
			createTask({
				id: 2,
				title: 'Two',
				dependencies: ['1'],
				subtasks: [
					{
						id: 1,
						title: 'Sub',
						description: 'Sub',
						status: 'pending',
						dependencies: []
					} as any
				]
			})
		];
		const file = createTasksFile({ tasks });
		fs.writeFileSync(
			tasksPath,
			JSON.stringify({ master: file.master, other: file.master }, null, 2)
		);
	});

	afterEach(() => {
		process.chdir(repoRoot);
		fs.rmSync(testDir, { recursive: true, force: true });
	});

	it('remove_dependency', () => {
		const out = callMCPTool('remove_dependency', {
			id: '2',
			dependsOn: '1',
			tag: 'other',
			projectRoot: testDir
		});
		expect(out.tag).toBe('other');
		expect(readTag('other')[1].dependencies).toEqual([]);
		expect(readTag('master')[1].dependencies).toEqual(['1']);
	}, 30000);

	it('add_subtask', () => {
		const out = callMCPTool('add_subtask', {
			id: '1',
			title: 'New',
			description: 'New',
			tag: 'other',
			projectRoot: testDir
		});
		expect(out.tag).toBe('other');
		expect(readTag('other')[0].subtasks).toHaveLength(1);
	}, 30000);

	it('remove_subtask', () => {
		const out = callMCPTool('remove_subtask', {
			id: '2.1',
			tag: 'other',
			projectRoot: testDir
		});
		expect(out.tag).toBe('other');
		expect(readTag('other')[1].subtasks ?? []).toEqual([]);
		expect(readTag('master')[1].subtasks).toHaveLength(1);
	}, 30000);

	it('without a tag the reply names the current tag', () => {
		const out = callMCPTool('remove_dependency', {
			id: '2',
			dependsOn: '1',
			projectRoot: testDir
		});
		expect(out.tag).toBe('master');
	}, 30000);
});

/** The `{ ... }` argument of each handleApiResult call after `from` */
function replyArguments(source: string, from: number): string[] {
	const calls: string[] = [];
	const call = /handleApiResult\(\{/g;
	call.lastIndex = from;
	for (let m = call.exec(source); m; m = call.exec(source)) {
		let depth = 1;
		let end = call.lastIndex;
		while (depth > 0 && end < source.length) {
			const c = source[end++];
			if (c === '{' || c === '(') depth++;
			else if (c === '}' || c === ')') depth--;
		}
		calls.push(source.slice(call.lastIndex, end - 1));
	}
	return calls;
}

describe('tools that resolve a tag', () => {
	it('pass it to every reply after resolving it', () => {
		// Without `tag`, handleApiResult names the current tag, not the one the
		// tool worked in
		const root = path.join(repoRoot, 'mcp-server', 'src', 'tools');
		const offenders = fs
			.readdirSync(root)
			.filter((f) => f.endsWith('.js'))
			.filter((f) => {
				const source = fs.readFileSync(path.join(root, f), 'utf8');
				const resolved = source.indexOf('= resolveTag(');
				return (
					resolved !== -1 &&
					replyArguments(source, resolved).some((a) => !/^\s*tag\b/m.test(a))
				);
			});
		expect(offenders).toEqual([]);
	});
});
