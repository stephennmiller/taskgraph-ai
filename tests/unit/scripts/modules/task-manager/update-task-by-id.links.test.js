/**
 * update-task keeps a task's related and discovered-from links
 * (metadata.taskLinks) when the AI rewrites it, and --metadata can't
 * overwrite them.
 */
import { vi } from 'vitest';

vi.doMock('fs', () => {
	const mockFs = {
		existsSync: vi.fn(() => true),
		writeFileSync: vi.fn(),
		readFileSync: vi.fn(),
		unlinkSync: vi.fn()
	};
	return { default: mockFs, ...mockFs };
});

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
		.mockResolvedValue({ mainResult: { content: '{}' }, telemetryData: {} }),
	generateObjectService: vi.fn().mockResolvedValue({
		mainResult: {
			task: {
				id: 1,
				title: 'Updated Task',
				description: 'Updated description',
				status: 'pending',
				dependencies: [],
				priority: 'medium',
				details: null,
				testStrategy: null,
				subtasks: []
			}
		},
		telemetryData: {}
	})
}));

vi.doMock('../../../../../scripts/modules/config-manager.js', () => ({
	getDebugFlag: vi.fn(() => false),
	isApiKeySet: vi.fn(() => true),
	hasCodebaseAnalysis: vi.fn(() => false)
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

// Mock the prompt manager
vi.doMock('@tm/core', async () => ({
	...(await vi.importActual('@tm/core')),
	getPromptManager: vi.fn().mockReturnValue({
		loadPrompt: vi.fn((promptId, params) => ({
			systemPrompt:
				'You are an AI assistant that helps update a software development task with new requirements and information.',
			userPrompt: `Update the following task based on the provided information: ${params?.updatePrompt || 'User prompt for task update'}`,
			metadata: {
				templateId: 'update-task',
				version: '1.0.0',
				variant: 'default',
				parameters: params || {}
			}
		}))
	})
}));

// Mock contextGatherer module
vi.doMock('../../../../../scripts/modules/utils/contextGatherer.js', () => ({
	ContextGatherer: vi.fn().mockImplementation(function () {
		return {
			gather: vi.fn().mockResolvedValue({
				fullContext: '',
				summary: ''
			})
		};
	})
}));

// Mock fuzzyTaskSearch module
vi.doMock('../../../../../scripts/modules/utils/fuzzyTaskSearch.js', () => ({
	FuzzyTaskSearch: vi.fn().mockImplementation(function () {
		return {
			search: vi.fn().mockReturnValue([]),
			findRelevantTasks: vi.fn().mockReturnValue([]),
			getTaskIds: vi.fn().mockReturnValue([])
		};
	})
}));

const { readJSON, writeJSON } = await import(
	'../../../../../scripts/modules/utils.js'
);
const fs = await import('fs');
const { generateObjectService } = await import(
	'../../../../../scripts/modules/ai-services-unified.js'
);
const { default: updateTaskById } = await import(
	'../../../../../scripts/modules/task-manager/update-task-by-id.js'
);

const LINKS = { 4: 'related', 3: 'discovered-from' };

const storedTasks = () => ({
	tag: 'master',
	tasks: [
		{ id: 3, title: 'Found it here', status: 'done', dependencies: [] },
		{ id: 4, title: 'Neighbour', status: 'pending', dependencies: [] },
		{
			id: 7,
			title: 'Original Task',
			description: 'Original description',
			status: 'pending',
			dependencies: [],
			priority: 'low',
			details: null,
			testStrategy: null,
			metadata: { owner: 'sam', taskLinks: { ...LINKS } },
			subtasks: [
				{
					id: 1,
					title: 'S1',
					status: 'pending',
					dependencies: [],
					metadata: { taskLinks: { 4: 'related' } }
				}
			]
		}
	]
});

const aiRewrite = () => ({
	mainResult: {
		task: {
			id: 7,
			title: 'Updated Task',
			description: 'Updated description',
			status: 'pending',
			dependencies: [],
			priority: 'high',
			details: 'd',
			testStrategy: 't',
			subtasks: [{ id: 1, title: 'S1', status: 'pending', dependencies: [] }]
		}
	},
	telemetryData: {}
});

describe('updateTaskById task links', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		fs.existsSync.mockReturnValue(true);
		readJSON.mockReturnValue(storedTasks());
		generateObjectService.mockResolvedValue(aiRewrite());
	});

	test('keeps related and discovered-from links through an AI rewrite', async () => {
		const { updatedTask } = await updateTaskById(
			'tasks/tasks.json',
			7,
			'Rewrite it',
			false,
			{ tag: 'master' },
			'json'
		);

		expect(updatedTask.dependencies).toEqual([]);
		expect(updatedTask.metadata).toEqual({ owner: 'sam', taskLinks: LINKS });
		expect(updatedTask.subtasks[0].metadata).toEqual({
			taskLinks: { 4: 'related' }
		});
	});

	test('--metadata with a prompt cannot overwrite the links', async () => {
		const { updatedTask } = await updateTaskById(
			'tasks/tasks.json',
			7,
			'Rewrite it',
			false,
			{ tag: 'master', metadata: { sprint: 2, taskLinks: { 9: 'related' } } },
			'json'
		);

		expect(updatedTask.metadata).toEqual({
			owner: 'sam',
			sprint: 2,
			taskLinks: LINKS
		});
	});

	test('--metadata alone cannot overwrite the links', async () => {
		await updateTaskById(
			'tasks/tasks.json',
			7,
			'',
			false,
			{ tag: 'master', metadata: { sprint: 2, taskLinks: {} } },
			'json'
		);

		expect(generateObjectService).not.toHaveBeenCalled();
		const written = writeJSON.mock.calls.at(-1)[1];
		const task = written.tasks.find((t) => t.id === 7);
		expect(task.metadata).toEqual({
			owner: 'sam',
			sprint: 2,
			taskLinks: LINKS
		});
	});
});
