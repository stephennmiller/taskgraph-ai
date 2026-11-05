import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTmCore, type TmCore } from '../../../tm-core.js';
import { AiService } from '../../ai/ai-service.js';
import { getPromptManager } from '../../ai/prompts/prompt-manager.js';
import { readComplexityReport } from './analyze-complexity.service.js';

describe('readComplexityReport', () => {
	it('finds no report for a stored tag that is not a valid tag name, instead of throwing', () => {
		expect(readComplexityReport(os.tmpdir(), { tag: 'a/b' })).toBeNull();
	});
});

describe('AnalyzeComplexityService.analyze, tasks with subtasks (#991)', () => {
	let projectDir: string;
	let tmCore: TmCore | undefined;
	const reportFile = () =>
		path.join(
			projectDir,
			'.taskgraph',
			'reports',
			'task-complexity-report.json'
		);
	const task = (id: number, subtasks: unknown[] = []) => ({
		id,
		title: `Task ${id}`,
		description: '',
		status: 'pending',
		dependencies: [],
		priority: 'medium',
		details: '',
		testStrategy: '',
		subtasks
	});
	const entry = (taskId: number, complexityScore: number) => ({
		taskId,
		taskTitle: `Task ${taskId}`,
		complexityScore,
		recommendedSubtasks: 3,
		expansionPrompt: '',
		reasoning: ''
	});
	const subtask = {
		id: 1,
		title: 'Done already',
		description: '',
		status: 'pending',
		dependencies: [],
		details: ''
	};
	const analyze = async (ids: number[], input: { ids?: string } = {}) => {
		const load = vi.spyOn(getPromptManager(), 'loadPrompt');
		vi.spyOn(AiService.prototype, 'generateObject').mockResolvedValue({
			mainResult: { complexityAnalysis: ids.map((id) => entry(id, 6)) },
			telemetryData: null
		} as any);
		tmCore = await createTmCore({ projectPath: projectDir });
		const result = await tmCore.tasks.analyzeComplexity(input);
		const vars = load.mock.calls.find(
			(c) => c[0] === 'analyze-complexity'
		)?.[1];
		return { result, asked: vars?.tasks.map((t: { id: number }) => t.id) };
	};

	beforeEach(() => {
		projectDir = fs.realpathSync(
			fs.mkdtempSync(path.join(os.tmpdir(), 'tm-analyze-expanded-'))
		);
		fs.mkdirSync(path.join(projectDir, '.taskgraph', 'tasks'), {
			recursive: true
		});
		fs.mkdirSync(path.join(projectDir, '.taskgraph', 'reports'));
		fs.writeFileSync(
			path.join(projectDir, '.taskgraph', 'config.json'),
			JSON.stringify({ models: {}, global: {} })
		);
		fs.writeFileSync(
			path.join(projectDir, '.taskgraph', 'tasks', 'tasks.json'),
			JSON.stringify({
				master: {
					tasks: [task(1), task(2, [subtask]), { ...task(3), status: 'done' }],
					metadata: {}
				}
			})
		);
		fs.writeFileSync(
			reportFile(),
			JSON.stringify({ meta: {}, complexityAnalysis: [entry(2, 9)] })
		);
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await tmCore?.close();
		tmCore = undefined;
		fs.rmSync(projectDir, { recursive: true, force: true });
	});

	it('skips them by default, counts them as skipped and keeps their report entry', async () => {
		const { result, asked } = await analyze([1]);

		expect(asked).toEqual([1]);
		expect(result).toMatchObject({ skipped: 2, skippedWithSubtasks: 1 });
		const saved = JSON.parse(fs.readFileSync(reportFile(), 'utf8'));
		expect(saved.complexityAnalysis).toEqual([entry(2, 9), entry(1, 6)]);
	});

	it('still analyzes one named with ids', async () => {
		const { result, asked } = await analyze([2], { ids: '2' });

		expect(asked).toEqual([2]);
		expect(result).toMatchObject({ skipped: 0, skippedWithSubtasks: 0 });
		expect(result.analyses).toEqual([entry(2, 6)]);
	});
});
