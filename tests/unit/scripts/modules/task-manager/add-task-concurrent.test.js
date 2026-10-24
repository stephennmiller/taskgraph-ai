/**
 * addTask keeps changes another process makes to tasks.json while the AI call
 * is running, and does not reuse a task ID that was taken in the meantime.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { vi } from 'vitest';

// Real file I/O from utils; only logging is silenced
vi.doMock('../../../../../scripts/modules/utils.js', async () => {
	const actual = await vi.importActual(
		'../../../../../scripts/modules/utils.js'
	);
	return { ...actual, log: vi.fn(), isSilentMode: vi.fn(() => true) };
});

vi.doMock('../../../../../scripts/modules/ui.js', () => ({
	startLoadingIndicator: vi.fn(),
	stopLoadingIndicator: vi.fn(),
	succeedLoadingIndicator: vi.fn(),
	failLoadingIndicator: vi.fn(),
	warnLoadingIndicator: vi.fn(),
	infoLoadingIndicator: vi.fn(),
	displayAiUsageSummary: vi.fn()
}));

vi.doMock('../../../../../scripts/modules/ai-services-unified.js', () => ({
	generateObjectService: vi.fn()
}));

vi.doMock('../../../../../scripts/modules/config-manager.js', () => ({
	getDefaultPriority: vi.fn(() => 'medium'),
	hasCodebaseAnalysis: vi.fn(() => false)
}));

vi.doMock('../../../../../scripts/modules/utils/contextGatherer.js', () => ({
	ContextGatherer: vi.fn().mockImplementation(function () {
		return {
			gather: vi.fn().mockResolvedValue({
				contextSummary: '',
				allRelatedTaskIds: [],
				graphVisualization: ''
			})
		};
	})
}));

vi.doMock('../../../../../scripts/modules/prompt-manager.js', () => ({
	getPromptManager: vi.fn().mockReturnValue({
		loadPrompt: vi.fn().mockResolvedValue({
			systemPrompt: 'system',
			userPrompt: 'user'
		})
	})
}));

const { generateObjectService } = await import(
	'../../../../../scripts/modules/ai-services-unified.js'
);
const { default: addTask } = await import(
	'../../../../../scripts/modules/task-manager/add-task.js'
);

const task = (id, title) => ({
	id,
	title,
	description: title,
	status: 'pending',
	dependencies: [],
	priority: 'medium',
	subtasks: []
});

describe('addTask with another writer', () => {
	let dir;
	let tasksPath;

	const readFile = () => JSON.parse(fs.readFileSync(tasksPath, 'utf8'));

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-add-task-'));
		fs.mkdirSync(path.join(dir, '.taskgraph', 'tasks'), { recursive: true });
		tasksPath = path.join(dir, '.taskgraph', 'tasks', 'tasks.json');
		fs.writeFileSync(
			tasksPath,
			JSON.stringify({
				master: { tasks: [task(1, 'First')], metadata: {} },
				other: { tasks: [task(1, 'Elsewhere')], metadata: {} }
			})
		);
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test('keeps a task added while the AI call runs and picks a free ID', async () => {
		generateObjectService.mockImplementation(async () => {
			// Another process adds task 2 and finishes task 1 during the AI call,
			// saving the ID as a string as tm-core does (#392)
			const current = readFile();
			current.master.tasks[0].status = 'done';
			current.master.tasks.push(task('2', 'Added meanwhile'));
			fs.writeFileSync(tasksPath, JSON.stringify(current));
			return {
				mainResult: {
					object: {
						title: 'From the AI',
						description: 'd',
						details: '',
						testStrategy: '',
						dependencies: []
					}
				},
				telemetryData: {}
			};
		});

		const result = await addTask(
			tasksPath,
			'Do something',
			[],
			'medium',
			{
				mcpLog: {
					info: vi.fn(),
					warn: vi.fn(),
					error: vi.fn(),
					debug: vi.fn(),
					success: vi.fn()
				},
				projectRoot: dir,
				tag: 'master'
			},
			'json'
		);

		const saved = readFile();
		expect(saved.master.tasks.map((t) => [t.id, t.title])).toEqual([
			['1', 'First'],
			['2', 'Added meanwhile'],
			['3', 'From the AI']
		]);
		expect(saved.master.tasks[0].status).toBe('done');
		expect(result.newTaskId).toBe(3);
		expect(saved.other.tasks).toHaveLength(1);
	});

	test('still creates the file when there is none', async () => {
		fs.rmSync(tasksPath);
		generateObjectService.mockResolvedValue({
			mainResult: {
				object: {
					title: 'First ever',
					description: 'd',
					details: '',
					testStrategy: '',
					dependencies: []
				}
			},
			telemetryData: {}
		});

		const result = await addTask(
			tasksPath,
			'Do something',
			[],
			'medium',
			{
				mcpLog: {
					info: vi.fn(),
					warn: vi.fn(),
					error: vi.fn(),
					debug: vi.fn(),
					success: vi.fn()
				},
				projectRoot: dir,
				tag: 'master'
			},
			'json'
		);

		expect(result.newTaskId).toBe(1);
		expect(readFile().master.tasks.map((t) => t.title)).toEqual(['First ever']);
	});
});
