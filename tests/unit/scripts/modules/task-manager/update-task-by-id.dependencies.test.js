/**
 * update-task keeps what a subtask dependency the AI writes names: a number
 * is a sibling, "3" is task 3 and "3.2" is a subtask (#213).
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

import { resolveSubtaskDependency } from '@tm/core';
import { COMMAND_SCHEMAS } from '../../../../../src/schemas/registry.js';

const subtask = (id, title, dependencies) => ({
	id,
	title,
	description: `Description of ${title}`,
	dependencies,
	details: `Implementation details of ${title}`,
	status: 'pending',
	testStrategy: null
});

describe('updateTaskById subtask dependencies', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		fs.existsSync.mockReturnValue(true);
	});

	test('keeps a dependency on a task below 100 as that task, not a sibling', async () => {
		readJSON.mockReturnValue({
			tag: 'master',
			tasks: [
				{
					id: 2,
					title: 'Set up database',
					status: 'pending',
					dependencies: []
				},
				{
					id: 5,
					title: 'Original Task',
					description: 'Original description',
					status: 'pending',
					dependencies: [],
					priority: 'low',
					details: null,
					testStrategy: null,
					subtasks: []
				}
			]
		});
		const aiTask = {
			id: 5,
			title: 'Original Task',
			description: 'Updated description',
			status: 'pending',
			dependencies: [],
			priority: 'low',
			details: null,
			testStrategy: null,
			subtasks: [
				subtask(1, 'Write the schema', []),
				subtask(2, 'Write the migration', []),
				// Sibling 1, task 2 (not sibling 2) and subtask 2.1
				subtask(3, 'Seed the tables', [1, '2', '2.1'])
			]
		};
		// The AI response schema must accept the string forms
		expect(() =>
			COMMAND_SCHEMAS['update-task-by-id'].parse({ task: aiTask })
		).not.toThrow();
		generateObjectService.mockResolvedValue({
			mainResult: { task: aiTask },
			telemetryData: {}
		});

		const { updatedTask } = await updateTaskById(
			'tasks/tasks.json',
			5,
			'Seed the tables after the database is set up',
			false,
			{ tag: 'master' },
			'json'
		);

		const seed = updatedTask.subtasks[2];
		expect(seed.dependencies).toEqual([1, '2', '2.1']);
		expect(
			seed.dependencies.map((dep) => resolveSubtaskDependency(5, dep))
		).toEqual(['5.1', '2', '2.1']);
	});
});
