import { vi } from 'vitest';

// Provide fs mock early so existsSync can be stubbed
vi.doMock('fs', () => {
	const mockFs = {
		existsSync: vi.fn(() => true),
		writeFileSync: vi.fn(),
		readFileSync: vi.fn(),
		unlinkSync: vi.fn()
	};
	return { default: mockFs, ...mockFs };
});

// --- Mock dependencies ---
vi.doMock('../../../../../scripts/modules/utils.js', () => ({
	readJSON: vi.fn(),
	writeJSON: vi.fn(),
	log: vi.fn(),
	isSilentMode: vi.fn(() => false),
	findProjectRoot: vi.fn(() => '/project'),
	flattenTasksWithSubtasks: vi.fn(() => []),
	truncate: vi.fn((t) => t),
	isEmpty: vi.fn(() => false),
	resolveEnvVariable: vi.fn(),
	findTaskById: vi.fn(),
	getCurrentTag: vi.fn(() => 'master'),
	resolveTag: vi.fn(() => 'master'),
	addComplexityToTask: vi.fn((task, complexity) => ({ ...task, complexity })),
	getTasksForTag: vi.fn((data, tag) => data[tag]?.tasks || []),
	setTasksForTag: vi.fn(),
	ensureTagMetadata: vi.fn((tagObj) => tagObj)
}));

vi.doMock('../../../../../scripts/modules/ui.js', () => ({
	displayBanner: vi.fn(),
	getStatusWithColor: vi.fn((s) => s),
	startLoadingIndicator: vi.fn(() => ({ stop: vi.fn() })),
	stopLoadingIndicator: vi.fn(),
	succeedLoadingIndicator: vi.fn(),
	failLoadingIndicator: vi.fn(),
	warnLoadingIndicator: vi.fn(),
	infoLoadingIndicator: vi.fn(),
	displayAiUsageSummary: vi.fn(),
	displayContextAnalysis: vi.fn()
}));

vi.doMock('../../../../../scripts/modules/ai-services-unified.js', () => ({
	generateTextService: vi
		.fn()
		.mockResolvedValue({ mainResult: { content: '' }, telemetryData: {} })
}));

vi.doMock('../../../../../scripts/modules/config-manager.js', () => ({
	getDebugFlag: vi.fn(() => false),
	hasCodebaseAnalysis: vi.fn(() => false)
}));

vi.doMock('../../../../../scripts/modules/prompt-manager.js', () => ({
	default: vi.fn().mockReturnValue({
		loadPrompt: vi.fn().mockReturnValue('Update the subtask')
	}),
	getPromptManager: vi.fn().mockReturnValue({
		loadPrompt: vi.fn().mockReturnValue('Update the subtask')
	})
}));

vi.doMock('../../../../../scripts/modules/utils/contextGatherer.js', () => ({
	ContextGatherer: vi.fn().mockImplementation(function () {
		return {
			gather: vi.fn().mockReturnValue({
				fullContext: '',
				summary: ''
			})
		};
	})
}));

// Mock bridge-utils module
vi.doMock('../../../../../scripts/modules/bridge-utils.js', () => ({
	createBridgeLogger: vi.fn(() => ({
		logger: {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			debug: vi.fn()
		},
		report: vi.fn(),
		isMCP: false
	}))
}));

// Mock fuzzyTaskSearch module
vi.doMock('../../../../../scripts/modules/utils/fuzzyTaskSearch.js', () => ({
	FuzzyTaskSearch: vi.fn().mockImplementation(function () {
		return {
			search: vi.fn().mockReturnValue([])
		};
	})
}));

// Import mocked utils to leverage mocks later
const { readJSON, log } = await import(
	'../../../../../scripts/modules/utils.js'
);

// Import function under test
const { default: updateSubtaskById } = await import(
	'../../../../../scripts/modules/task-manager/update-subtask-by-id.js'
);

describe('updateSubtaskById validation', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(process, 'exit').mockImplementation(() => {
			throw new Error('process.exit called');
		});
	});

	test('throws error on invalid subtask id format', async () => {
		await expect(
			updateSubtaskById(
				'tasks/tasks.json',
				'invalid',
				'my prompt',
				false,
				{
					tag: 'master'
				},
				'json'
			)
		).rejects.toThrow('Invalid subtask ID format');
	});

	test('throws error when prompt is empty', async () => {
		await expect(
			updateSubtaskById(
				'tasks/tasks.json',
				'1.1',
				'',
				false,
				{ tag: 'master' },
				'json'
			)
		).rejects.toThrow('Prompt cannot be empty');
	});

	test('throws error if tasks file does not exist', async () => {
		// Mock fs.existsSync to return false via vi.spyOn (dynamic import of fs)
		const fs = await import('fs');
		fs.existsSync.mockReturnValue(false);
		await expect(
			updateSubtaskById(
				'tasks/tasks.json',
				'1.1',
				'prompt',
				false,
				{
					tag: 'master'
				},
				'json'
			)
		).rejects.toThrow('Tasks file not found');
	});

	test('throws error if parent task missing', async () => {
		// Mock existsSync true
		const fs = await import('fs');
		fs.existsSync.mockReturnValue(true);
		// readJSON returns tasks without parent id 1
		readJSON.mockReturnValue({ tag: 'master', tasks: [] });
		await expect(
			updateSubtaskById(
				'tasks/tasks.json',
				'1.1',
				'prompt',
				false,
				{
					tag: 'master'
				},
				'json'
			)
		).rejects.toThrow('Task 1 not found');
		// log called with error level
		expect(log).toHaveBeenCalled();
	});

	test('successfully updates subtask with valid inputs', async () => {
		const fs = await import('fs');
		const { writeJSON } = await import(
			'../../../../../scripts/modules/utils.js'
		);

		fs.existsSync.mockReturnValue(true);
		readJSON.mockReturnValue({
			tag: 'master',
			tasks: [
				{
					id: 1,
					title: 'Parent Task',
					subtasks: [{ id: 1, title: 'Original subtask', status: 'pending' }]
				}
			]
		});

		// updateSubtaskById doesn't return a value on success, it just executes
		await expect(
			updateSubtaskById(
				'tasks/tasks.json',
				'1.1',
				'Update this subtask',
				false,
				{ tag: 'master' },
				'json'
			)
		).resolves.not.toThrow();

		expect(writeJSON).toHaveBeenCalled();
	});
});
