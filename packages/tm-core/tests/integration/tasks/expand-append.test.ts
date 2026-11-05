/**
 * @fileoverview tasks.expand and expandAll with append (#992) against a real
 * tasks.json: the subtasks stay, the AI sees them, and the new ones are
 * numbered after them. Only the AI call is mocked.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiService } from '../../../src/modules/ai/ai-service.js';
import { type TmCore, createTmCore } from '../../../src/tm-core.js';
import { answer, fixture, sub } from './expand-fixtures.js';

describe('tasks.expand with append (#992)', () => {
	let projectDir: string;
	let tasksPath: string;
	let tmCore: TmCore;
	let generateObject: ReturnType<typeof vi.spyOn>;

	const readFile = () => JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
	const write = (data: unknown) =>
		fs.writeFileSync(tasksPath, JSON.stringify(data));

	beforeEach(async () => {
		projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-expand-append-'));
		const tgDir = path.join(projectDir, '.taskgraph');
		fs.mkdirSync(path.join(tgDir, 'tasks'), { recursive: true });
		fs.writeFileSync(
			path.join(tgDir, 'config.json'),
			JSON.stringify({ models: {}, global: { enableCodebaseAnalysis: false } })
		);
		tasksPath = path.join(tgDir, 'tasks', 'tasks.json');
		write(fixture());
		generateObject = vi
			.spyOn(AiService.prototype, 'generateObject')
			.mockResolvedValue(answer() as any);
		tmCore = await createTmCore({ projectPath: projectDir });
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await tmCore?.close();
		fs.rmSync(projectDir, { recursive: true, force: true });
	});

	it('keeps the subtasks, shows them to the AI and numbers after the highest ID', async () => {
		const data = fixture();
		data.master.tasks[1].subtasks = [
			sub(1, 'Parse flags', { status: 'done' }),
			sub(5, 'Parse commands')
		];
		write(data);

		await tmCore.tasks.expand({ id: '2', num: 2, append: true });

		const { prompt } = generateObject.mock.calls[0][0] as any;
		expect(prompt).toContain('## Existing subtasks');
		expect(prompt).toContain(
			'- 2.1 (done) Parse flags: Parse flags sub description'
		);
		expect(prompt).toContain('- 2.5 (pending) Parse commands');
		expect(prompt).toContain("Keep them: don't repeat or rewrite them");
		expect(prompt).toContain('starting from 6');
		expect(
			readFile().master.tasks[1].subtasks.map((s: any) => [
				String(s.id),
				s.title,
				s.status
			])
		).toEqual([
			['1', 'Parse flags', 'done'],
			['5', 'Parse commands', 'pending'],
			['6', 'Step 1', 'pending'],
			['7', 'Step 2', 'pending']
		]);
	});

	it('expands a task with subtasks under keepExpanded (MCP expand_task)', async () => {
		const result = await tmCore.tasks.expand({
			id: '2',
			num: 2,
			append: true,
			keepExpanded: true
		});

		expect(result.skipped).toBeUndefined();
		expect(result.task.subtasks).toHaveLength(4);
	});

	it('leaves the prompt as it was for a task without subtasks', async () => {
		await tmCore.tasks.expand({ id: '3', num: 2, append: true });

		const { prompt } = generateObject.mock.calls[0][0] as any;
		expect(prompt).not.toContain('Existing subtasks');
	});

	it('refuses append with force before any AI call', async () => {
		await expect(
			tmCore.tasks.expand({ id: '2', append: true, force: true })
		).rejects.toThrow("append and force can't be used together");
		expect(generateObject).not.toHaveBeenCalled();
		expect(readFile().master.tasks[1].subtasks).toHaveLength(2);
	});
});
