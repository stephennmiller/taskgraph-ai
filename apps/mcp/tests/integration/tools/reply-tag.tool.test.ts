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
		// #661: the reply gives the full ID; tasks.json keeps the subtask's own number
		expect(out.data.subtask.id).toBe('1.1');
		expect(String(readTag('other')[0].subtasks[0].id)).toBe('1');
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

	it('an error reply names the tag it looked in', () => {
		expect(() =>
			callMCPTool('get_task', {
				id: '99',
				tag: 'other',
				projectRoot: testDir
			})
		).toThrow(/Current Tag: other/);
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

/**
 * The top-level keys of each `handleApiResult({ ... })` argument after
 * `from`: nested objects such as `result: { data: { tag } }` are left out, so
 * a `tag` inside them does not count as the reply's tag
 */
function replyArguments(source: string, from: number): string[] {
	const calls: string[] = [];
	const call = /handleApiResult\(\{/g;
	call.lastIndex = from;
	for (let m = call.exec(source); m; m = call.exec(source)) {
		let depth = 1;
		let end = call.lastIndex;
		let topLevel = '';
		while (depth > 0 && end < source.length) {
			const c = source[end++];
			if (c === '{' || c === '(' || c === '[') depth++;
			else if (c === '}' || c === ')' || c === ']') depth--;
			else if (depth === 1) topLevel += c;
		}
		calls.push(topLevel);
	}
	return calls;
}

/** Files under `dir` whose replies come after the tag is known */
function offenders(dir: string, tagKnownAt: RegExp): string[] {
	return fs
		.readdirSync(dir, { recursive: true, encoding: 'utf8' })
		.filter((f) => /\.(js|ts)$/.test(f) && !/\.(spec|test)\./.test(f))
		.filter((f) => {
			const source = fs.readFileSync(path.join(dir, f), 'utf8');
			const known = source.search(tagKnownAt);
			return (
				known !== -1 &&
				replyArguments(source, known).some((a) => !/^\s*tag\b/m.test(a))
			);
		});
}

describe('tools that take a tag', () => {
	// Without `tag`, handleApiResult names the current tag, not the one the
	// tool worked in
	it('@tm/mcp tools pass the tag argument to every reply', () => {
		const root = path.join(repoRoot, 'apps', 'mcp', 'src', 'tools');
		expect(offenders(root, /const \{[^}]*\btag\b[^}]*\} = args/)).toEqual([]);
	});
});
