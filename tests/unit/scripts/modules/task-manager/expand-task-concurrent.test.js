/**
 * expandTask keeps changes another process makes to tasks.json while the AI
 * call is running.
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
	displayAddedSubtasks: vi.fn(),
	displayAiUsageSummary: vi.fn(),
	startLoadingIndicator: vi.fn(),
	stopLoadingIndicator: vi.fn()
}));

vi.doMock('../../../../../scripts/modules/ai-services-unified.js', () => ({
	generateObjectService: vi.fn()
}));

vi.doMock('../../../../../scripts/modules/config-manager.js', () => ({
	getDefaultSubtasks: vi.fn(() => 3),
	hasCodebaseAnalysis: vi.fn(() => false)
}));

vi.doMock('../../../../../scripts/modules/utils/contextGatherer.js', () => ({
	ContextGatherer: vi.fn().mockImplementation(function () {
		return { gather: vi.fn().mockResolvedValue({ context: '' }) };
	})
}));

vi.doMock('../../../../../scripts/modules/utils/fuzzyTaskSearch.js', () => ({
	FuzzyTaskSearch: vi.fn().mockImplementation(function () {
		return {
			findRelevantTasks: vi.fn().mockReturnValue([]),
			getTaskIds: vi.fn().mockReturnValue([])
		};
	})
}));

vi.doMock('../../../../../scripts/modules/prompt-manager.js', () => ({
	getPromptManager: vi.fn().mockReturnValue({
		loadPrompt: vi.fn().mockReturnValue({
			systemPrompt: 'system',
			userPrompt: 'user'
		})
	})
}));

const { generateObjectService } = await import(
	'../../../../../scripts/modules/ai-services-unified.js'
);
const { default: expandTask } = await import(
	'../../../../../scripts/modules/task-manager/expand-task.js'
);

const task = (id, title, extra = {}) => ({
	id,
	title,
	description: title,
	status: 'pending',
	dependencies: [],
	priority: 'medium',
	details: '',
	testStrategy: '',
	subtasks: [],
	...extra
});

const subtask = (id, title) => ({
	id,
	title,
	description: title,
	dependencies: [],
	details: '',
	status: 'pending',
	testStrategy: null
});

describe('expandTask with another writer', () => {
	let dir;
	let tasksPath;

	const readFile = () => JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
	const context = () => ({
		mcpLog: {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			debug: vi.fn(),
			success: vi.fn()
		},
		projectRoot: dir,
		tag: 'master'
	});

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-expand-'));
		fs.mkdirSync(path.join(dir, '.taskgraph', 'tasks'), { recursive: true });
		tasksPath = path.join(dir, '.taskgraph', 'tasks', 'tasks.json');
		fs.writeFileSync(
			tasksPath,
			JSON.stringify({
				master: {
					tasks: [task(1, 'First'), task(2, 'Second')],
					metadata: {}
				},
				other: { tasks: [task(1, 'Elsewhere')], metadata: {} }
			})
		);
		generateObjectService.mockImplementation(async () => {
			// Another process finishes task 1 and adds task 3 during the AI call
			const current = readFile();
			current.master.tasks[0].status = 'done';
			current.master.tasks.push(task(3, 'Added meanwhile'));
			fs.writeFileSync(tasksPath, JSON.stringify(current));
			return {
				mainResult: {
					subtasks: [subtask(1, 'Step one'), subtask(2, 'Step two')]
				},
				telemetryData: {}
			};
		});
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test('adds the subtasks and keeps what changed meanwhile', async () => {
		await expandTask(tasksPath, 2, 2, false, '', context(), false);

		const saved = readFile();
		expect(saved.master.tasks.map((t) => [t.id, t.status])).toEqual([
			['1', 'done'],
			['2', 'pending'],
			['3', 'pending']
		]);
		expect(saved.master.tasks[1].subtasks.map((s) => s.title)).toEqual([
			'Step one',
			'Step two'
		]);
		expect(saved.other.tasks).toHaveLength(1);
	});

	test('finds the task in a file saved with string IDs, as tm-core saves them (#392)', async () => {
		const current = readFile();
		for (const t of current.master.tasks) t.id = String(t.id);
		fs.writeFileSync(tasksPath, JSON.stringify(current));

		await expandTask(tasksPath, 2, 2, false, '', context(), false);

		expect(readFile().master.tasks[1].subtasks).toHaveLength(2);
	});

	test('force drops dependencies and links on the old subtasks before adding new ones (#320)', async () => {
		// Task 1 depends on 2.2 and links to 2.1; the new subtasks reuse both IDs
		const current = readFile();
		current.master.tasks[0].dependencies = ['2.2'];
		current.master.tasks[0].metadata = {
			dependencySources: { 2.2: 'inferred' },
			taskLinks: { 2.1: 'related' }
		};
		current.master.tasks[1].subtasks = [
			subtask(1, 'Old one'),
			subtask(2, 'Old two')
		];
		fs.writeFileSync(tasksPath, JSON.stringify(current));

		await expandTask(tasksPath, 2, 2, false, '', context(), true);

		const saved = readFile().master.tasks;
		expect(saved[1].subtasks.map((s) => s.title)).toEqual([
			'Step one',
			'Step two'
		]);
		expect(saved[0].dependencies).toEqual([]);
		expect(saved[0].metadata).toBeUndefined();
	});

	test('fails clearly when the task was removed during the AI call', async () => {
		generateObjectService.mockImplementation(async () => {
			const current = readFile();
			current.master.tasks = current.master.tasks.filter((t) => t.id !== 2);
			fs.writeFileSync(tasksPath, JSON.stringify(current));
			return {
				mainResult: { subtasks: [subtask(1, 'Step one')] },
				telemetryData: {}
			};
		});

		await expect(
			expandTask(tasksPath, 2, 1, false, '', context(), false)
		).rejects.toThrow(/removed/);
		expect(readFile().master.tasks.map((t) => t.id)).toEqual([1]);
	});
});
