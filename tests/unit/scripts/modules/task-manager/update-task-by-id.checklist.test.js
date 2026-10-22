/**
 * update-task keeps a task's checklist (acceptance criteria and checked
 * Definition of Done items) when the AI rewrites it: the AI schema has no
 * such fields.
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

// Mock prompt-manager module
vi.doMock('../../../../../scripts/modules/prompt-manager.js', () => ({
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

const { readJSON } = await import('../../../../../scripts/modules/utils.js');
const fs = await import('fs');
const { generateObjectService } = await import(
	'../../../../../scripts/modules/ai-services-unified.js'
);
const { default: updateTaskById } = await import(
	'../../../../../scripts/modules/task-manager/update-task-by-id.js'
);

describe('updateTaskById checklist fields', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test('keeps acceptance criteria and checked Definition of Done items through an AI rewrite', async () => {
		const criteria = [
			{ text: 'Login works', checked: true },
			{ text: 'Tokens expire', checked: false }
		];
		fs.existsSync.mockReturnValue(true);
		readJSON.mockReturnValue({
			tag: 'master',
			tasks: [
				{
					id: 1,
					title: 'Original Task',
					description: 'Original description',
					status: 'pending',
					dependencies: [],
					priority: 'low',
					details: null,
					testStrategy: null,
					acceptanceCriteria: criteria,
					definitionOfDoneChecked: ['Tests pass'],
					subtasks: [
						{
							id: 1,
							title: 'S1',
							status: 'pending',
							dependencies: [],
							acceptanceCriteria: [{ text: 'Sub works', checked: false }]
						}
					]
				}
			]
		});
		generateObjectService.mockResolvedValue({
			mainResult: {
				task: {
					id: 1,
					title: 'Updated Task',
					description: 'Updated description',
					status: 'pending',
					dependencies: [],
					priority: 'high',
					details: 'd',
					testStrategy: 't',
					subtasks: [
						{ id: 1, title: 'S1', status: 'pending', dependencies: [] }
					]
				}
			},
			telemetryData: {}
		});

		const { updatedTask } = await updateTaskById(
			'tasks/tasks.json',
			1,
			'Rewrite it',
			false,
			{ tag: 'master' },
			'json'
		);

		expect(updatedTask.acceptanceCriteria).toEqual(criteria);
		expect(updatedTask.definitionOfDoneChecked).toEqual(['Tests pass']);
		expect(updatedTask.subtasks[0].acceptanceCriteria).toEqual([
			{ text: 'Sub works', checked: false }
		]);
	});
});
