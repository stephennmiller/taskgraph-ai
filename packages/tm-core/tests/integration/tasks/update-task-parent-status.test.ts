/**
 * @fileoverview tasks.updateWithPrompt (update-task) against a real
 * tasks.json: a rewrite that drops subtasks settles the parent's status from
 * the ones left (#1065, state-machines.md section 2). Only the AI call is
 * mocked. Kept apart from update-task.test.ts, which is over the file size limit.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiService } from '../../../src/modules/ai/ai-service.js';
import { type TmCore, createTmCore } from '../../../src/tm-core.js';

const sub = (id: number, status = 'pending') => ({
	id,
	title: `S${id}`,
	status,
	dependencies: [] as number[]
});

const parent = (subtasks: unknown[], extra = {}) => ({
	id: '1',
	title: 'Parent',
	description: 'Parent description',
	status: 'in-progress',
	dependencies: [] as string[],
	priority: 'medium',
	details: '',
	testStrategy: '',
	subtasks,
	...extra
});

describe('tasks.updateWithPrompt settles the parent (#1065)', () => {
	let projectDir: string;
	let tasksPath: string;
	let tmCore: TmCore;

	const saved = () =>
		JSON.parse(fs.readFileSync(tasksPath, 'utf8')).master.tasks[0];
	const write = (task: unknown) =>
		fs.writeFileSync(
			tasksPath,
			JSON.stringify({ master: { tasks: [task], metadata: {} } })
		);
	const rewriteWith = (subtasks: unknown[]) => {
		vi.spyOn(AiService.prototype, 'generateObject').mockResolvedValue({
			mainResult: { task: { ...parent(subtasks), id: 1, title: 'Rewritten' } },
			telemetryData: {},
			tagInfo: { currentTag: 'master', availableTags: ['master'] }
		} as any);
		return tmCore.tasks.updateWithPrompt({ id: '1', prompt: 'Drop a step' });
	};

	beforeEach(async () => {
		projectDir = fs.realpathSync(
			fs.mkdtempSync(path.join(os.tmpdir(), 'tm-update-task-parent-'))
		);
		const tgDir = path.join(projectDir, '.taskgraph');
		fs.mkdirSync(path.join(tgDir, 'tasks'), { recursive: true });
		fs.writeFileSync(
			path.join(tgDir, 'config.json'),
			JSON.stringify({ models: {}, global: {} })
		);
		tasksPath = path.join(tgDir, 'tasks', 'tasks.json');
		tmCore = await createTmCore({ projectPath: projectDir });
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await tmCore?.close();
		fs.rmSync(projectDir, { recursive: true, force: true });
	});

	it('sets an in-progress parent done when the rewrite drops its last open subtask', async () => {
		write(parent([sub(1, 'done'), sub(2)]));

		const result = await rewriteWith([sub(1, 'done')]);

		expect(saved().status).toBe('done');
		expect(saved().subtasks.map((s: any) => s.id)).toEqual(['1']);
		expect(result.task.status).toBe('done');
	});

	it('keeps an in-progress parent in progress when the rewrite drops its only in-progress subtask', async () => {
		write(parent([sub(1, 'in-progress'), sub(2), sub(3)]));

		await rewriteWith([sub(2), sub(3)]);

		// All pending sets a parent pending only on set-status (state-machines.md section 2)
		expect(saved().status).toBe('in-progress');
		expect(saved().subtasks.map((s: any) => s.id)).toEqual(['2', '3']);
	});

	it('keeps the parent in progress when its done gate refuses', async () => {
		write(
			parent([sub(1, 'done'), sub(2)], {
				acceptanceCriteria: [{ text: 'Reviewed', checked: false }]
			})
		);

		await rewriteWith([sub(1, 'done')]);

		expect(saved().status).toBe('in-progress');
	});
});
