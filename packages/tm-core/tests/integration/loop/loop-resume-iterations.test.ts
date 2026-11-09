/**
 * @fileoverview A loop resumed after an interruption starts on the
 * in-progress task, so the default iteration count includes it (#1067).
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type TmCore, createTmCore } from '../../../src/tm-core.js';

const task = (id: number, status: string, subtasks: unknown[] = []) => ({
	id,
	title: `Task ${id}`,
	description: '',
	status,
	priority: 'medium',
	dependencies: [],
	subtasks
});

describe('default loop iterations on a resumed run', () => {
	let projectDir: string;
	let tmCore: TmCore;

	beforeEach(async () => {
		projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-loop-resume-'));
		const tgDir = path.join(projectDir, '.taskgraph');
		fs.mkdirSync(path.join(tgDir, 'tasks'), { recursive: true });
		fs.writeFileSync(
			path.join(tgDir, 'config.json'),
			JSON.stringify({ models: {}, global: {} })
		);
		fs.writeFileSync(
			path.join(tgDir, 'tasks', 'tasks.json'),
			JSON.stringify({
				master: {
					tasks: [
						task(1, 'done'),
						task(2, 'in-progress'),
						task(3, 'pending'),
						task(4, 'review', [
							{ id: 1, title: 'Sub', description: '', dependencies: [] }
						])
					]
				}
			})
		);
		tmCore = await createTmCore({ projectPath: projectDir });
	});

	afterEach(async () => {
		await tmCore?.close();
		fs.rmSync(projectDir, { recursive: true, force: true });
	});

	it('counts the in-progress task with the pending ones', async () => {
		const pickableTaskCount = await tmCore.tasks.getPickableCount();

		// Tasks 2 and 3, and task 4's subtask with no status
		expect(pickableTaskCount).toBe(3);
		expect(
			tmCore.loop.resolveIterations({ preset: 'default', pickableTaskCount })
		).toBe(3);
	});
});
