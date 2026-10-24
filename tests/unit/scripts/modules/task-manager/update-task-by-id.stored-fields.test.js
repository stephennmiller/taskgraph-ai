/**
 * update-task keeps the stored fields the AI schema has no place for (#286):
 * the checklist (acceptance criteria and checked Definition of Done items),
 * GitHub link, tags, assignee and the rest.
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

const { readJSON } = await import('../../../../../scripts/modules/utils.js');
const fs = await import('fs');
const { generateObjectService } = await import(
	'../../../../../scripts/modules/ai-services-unified.js'
);
const { default: updateTaskById } = await import(
	'../../../../../scripts/modules/task-manager/update-task-by-id.js'
);

describe('updateTaskById stored fields', () => {
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

	test('keeps stored fields the AI schema has no place for (#286)', async () => {
		const github = { issue: 12, url: 'https://github.com/o/r/issues/12' };
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
					github,
					tags: ['api'],
					assignee: 'kim',
					relevantFiles: [{ path: 'src/a.ts' }],
					complexity: 7,
					createdAt: '2026-01-01T00:00:00.000Z',
					subtasks: [
						{
							id: 1,
							title: 'S1',
							status: 'pending',
							dependencies: [],
							assignee: 'lee',
							relevantFiles: [{ path: 'src/b.ts' }]
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
			'Tighten the description',
			false,
			{ tag: 'master' },
			'json'
		);

		expect(updatedTask).toMatchObject({
			title: 'Updated Task',
			priority: 'high',
			github,
			tags: ['api'],
			assignee: 'kim',
			relevantFiles: [{ path: 'src/a.ts' }],
			complexity: 7,
			createdAt: '2026-01-01T00:00:00.000Z'
		});
		expect(updatedTask.subtasks[0]).toMatchObject({
			assignee: 'lee',
			relevantFiles: [{ path: 'src/b.ts' }]
		});
	});

	test('drops the inferred mark of a dependency the AI removed', async () => {
		fs.existsSync.mockReturnValue(true);
		readJSON.mockReturnValue({
			tag: 'master',
			tasks: [
				{
					id: 1,
					title: 'Original Task',
					description: 'Original description',
					status: 'pending',
					dependencies: [3],
					metadata: { dependencySources: { 3: 'inferred' } },
					priority: 'low',
					details: null,
					testStrategy: null,
					subtasks: []
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
					priority: 'low',
					details: null,
					testStrategy: null,
					subtasks: []
				}
			},
			telemetryData: {}
		});

		const { updatedTask } = await updateTaskById(
			'tasks/tasks.json',
			1,
			'Drop the dependency',
			false,
			{ tag: 'master' },
			'json'
		);

		expect(updatedTask).not.toHaveProperty('metadata');
	});

	test('keeps stored details, priority and test strategy when the AI returns null for them', async () => {
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
					priority: 'high',
					details: 'Stored details',
					testStrategy: 'Stored strategy',
					subtasks: [
						{
							id: 1,
							title: 'S1',
							status: 'pending',
							dependencies: [],
							testStrategy: 'Sub strategy'
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
					priority: null,
					details: null,
					testStrategy: null,
					subtasks: [
						{
							id: 1,
							title: 'S1',
							status: 'pending',
							dependencies: [],
							testStrategy: null
						}
					]
				}
			},
			telemetryData: {}
		});

		const { updatedTask } = await updateTaskById(
			'tasks/tasks.json',
			1,
			'Tighten the description',
			false,
			{ tag: 'master' },
			'json'
		);

		expect(updatedTask).toMatchObject({
			priority: 'high',
			details: 'Stored details',
			testStrategy: 'Stored strategy'
		});
		expect(updatedTask.subtasks[0].testStrategy).toBe('Sub strategy');
	});
});
