// In tests/unit/parse-prd.test.js
// Testing parse-prd.js file extension compatibility with real files

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { vi } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mock the AI services to avoid real API calls
vi.doMock('../../scripts/modules/ai-services-unified.js', () => ({
	streamTextService: vi.fn(),
	generateObjectService: vi.fn(),
	streamObjectService: vi.fn().mockImplementation(async () => {
		return {
			get partialObjectStream() {
				return (async function* () {
					yield { tasks: [] };
					yield { tasks: [{ id: 1, title: 'Test Task', priority: 'high' }] };
				})();
			},
			object: Promise.resolve({
				tasks: [{ id: 1, title: 'Test Task', priority: 'high' }]
			})
		};
	})
}));

// Mock all config-manager exports comprehensively
vi.doMock('../../scripts/modules/config-manager.js', () => ({
	getDebugFlag: vi.fn(() => false),
	getDefaultPriority: vi.fn(() => 'medium'),
	getMainModelId: vi.fn(() => 'test-model'),
	getResearchModelId: vi.fn(() => 'test-research-model'),
	getParametersForRole: vi.fn(() => ({ maxTokens: 1000, temperature: 0.7 })),
	getMainProvider: vi.fn(() => 'anthropic'),
	getResearchProvider: vi.fn(() => 'perplexity'),
	getFallbackProvider: vi.fn(() => 'anthropic'),
	getResponseLanguage: vi.fn(() => 'English'),
	getDefaultNumTasks: vi.fn(() => 10),
	getDefaultSubtasks: vi.fn(() => 5),
	getLogLevel: vi.fn(() => 'info'),
	getConfig: vi.fn(() => ({})),
	getAllProviders: vi.fn(() => ['anthropic', 'perplexity']),
	MODEL_MAP: {},
	VALID_PROVIDERS: ['anthropic', 'perplexity'],
	validateProvider: vi.fn(() => true),
	validateProviderModelCombination: vi.fn(() => true),
	isApiKeySet: vi.fn(() => true),
	hasCodebaseAnalysis: vi.fn(() => false)
}));

// Mock utils comprehensively to prevent CLI behavior
vi.doMock('../../scripts/modules/utils.js', () => ({
	withFileLockSync: vi.fn((filepath, callback) => callback()),
	log: vi.fn(),
	writeJSON: vi.fn(),
	enableSilentMode: vi.fn(),
	disableSilentMode: vi.fn(),
	isSilentMode: vi.fn(() => false),
	getCurrentTag: vi.fn(() => 'master'),
	ensureTagMetadata: vi.fn(),
	readJSON: vi.fn(() => ({ master: { tasks: [] } })),
	findProjectRoot: vi.fn(() => '/tmp/test'),
	resolveEnvVariable: vi.fn(() => 'mock-key'),
	findTaskById: vi.fn(() => null),
	findTaskByPattern: vi.fn(() => []),
	validateTaskId: vi.fn(() => true),
	createTask: vi.fn(() => ({ id: 1, title: 'Mock Task' })),
	sortByDependencies: vi.fn((tasks) => tasks),
	isEmpty: vi.fn(() => false),
	truncate: vi.fn((text) => text),
	slugify: vi.fn((text) => text.toLowerCase()),
	getTagFromPath: vi.fn(() => 'master'),
	isValidTag: vi.fn(() => true),
	migrateToTaggedFormat: vi.fn(() => ({ master: { tasks: [] } })),
	performCompleteTagMigration: vi.fn(),
	resolveCurrentTag: vi.fn(() => 'master'),
	getDefaultTag: vi.fn(() => 'master'),
	performMigrationIfNeeded: vi.fn()
}));

// Mock prompt manager
vi.doMock('../../scripts/modules/prompt-manager.js', () => ({
	getPromptManager: vi.fn(() => ({
		loadPrompt: vi.fn(() => ({
			systemPrompt: 'Test system prompt',
			userPrompt: 'Test user prompt'
		}))
	}))
}));

vi.doMock('../../scripts/modules/ui.js', () => ({
	displayAiUsageSummary: vi.fn(),
	startLoadingIndicator: vi.fn(),
	succeedLoadingIndicator: vi.fn(),
	failLoadingIndicator: vi.fn()
}));

// Mock other potential UI elements
vi.doMock('ora', () => ({
	default: vi.fn(() => ({
		start: vi.fn(),
		stop: vi.fn(),
		succeed: vi.fn(),
		fail: vi.fn()
	}))
}));

// Mock constants
vi.doMock('../../src/constants/task-priority.js', () => ({
	DEFAULT_TASK_PRIORITY: 'medium',
	TASK_PRIORITY_OPTIONS: ['low', 'medium', 'high']
}));

// Import modules after mocking
const { generateObjectService } = await import(
	'../../scripts/modules/ai-services-unified.js'
);
const parsePRD = (
	await import('../../scripts/modules/task-manager/parse-prd/parse-prd.js')
).default;

describe('parse-prd file extension compatibility', () => {
	let tempDir;
	let testFiles;

	const mockTasksResponse = {
		tasks: [
			{
				id: 1,
				title: 'Test Task 1',
				description: 'First test task',
				status: 'pending',
				dependencies: [],
				priority: 'high',
				details: 'Implementation details for task 1',
				testStrategy: 'Unit tests for task 1'
			},
			{
				id: 2,
				title: 'Test Task 2',
				description: 'Second test task',
				status: 'pending',
				dependencies: [1],
				priority: 'medium',
				details: 'Implementation details for task 2',
				testStrategy: 'Integration tests for task 2'
			}
		],
		metadata: {
			projectName: 'Test Project',
			totalTasks: 2,
			sourceFile: 'test-prd',
			generatedAt: new Date().toISOString()
		}
	};

	const samplePRDContent = `# Test Project PRD

## Overview
Build a simple task management application.

## Features
1. Create and manage tasks
2. Set task priorities
3. Track task dependencies

## Technical Requirements
- React frontend
- Node.js backend
- PostgreSQL database

## Success Criteria
- Users can create tasks successfully
- Task dependencies work correctly`;

	beforeAll(() => {
		// Create temporary directory for test files
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parse-prd-test-'));

		// Create test files with different extensions
		testFiles = {
			txt: path.join(tempDir, 'test-prd.txt'),
			md: path.join(tempDir, 'test-prd.md'),
			rst: path.join(tempDir, 'test-prd.rst'),
			noExt: path.join(tempDir, 'test-prd')
		};

		// Write the same content to all test files
		Object.values(testFiles).forEach((filePath) => {
			fs.writeFileSync(filePath, samplePRDContent);
		});

		// Mock process.exit to prevent actual exit
		vi.spyOn(process, 'exit').mockImplementation(() => undefined);

		// Mock console methods to prevent output
		vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterAll(() => {
		// Clean up temporary directory
		fs.rmSync(tempDir, { recursive: true, force: true });

		// Restore mocks
		vi.restoreAllMocks();
	});

	beforeEach(() => {
		vi.clearAllMocks();

		// Mock successful AI response
		generateObjectService.mockResolvedValue({
			mainResult: { object: mockTasksResponse },
			telemetryData: {
				timestamp: new Date().toISOString(),
				userId: 'test-user',
				commandName: 'parse-prd',
				modelUsed: 'test-model',
				providerName: 'test-provider',
				inputTokens: 100,
				outputTokens: 200,
				totalTokens: 300,
				totalCost: 0.01,
				currency: 'USD'
			}
		});
	});

	test('should accept and parse .txt files', async () => {
		const outputPath = path.join(tempDir, 'tasks-txt.json');

		const result = await parsePRD(testFiles.txt, outputPath, 2, {
			force: true,
			mcpLog: {
				info: vi.fn(),
				warn: vi.fn(),
				error: vi.fn(),
				debug: vi.fn(),
				success: vi.fn()
			},
			projectRoot: tempDir
		});

		expect(result.success).toBe(true);
		expect(result.tasksPath).toBe(outputPath);
		expect(fs.existsSync(outputPath)).toBe(true);

		// Verify the content was parsed correctly
		const tasksData = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
		expect(tasksData.master.tasks).toHaveLength(2);
		expect(tasksData.master.tasks[0].title).toBe('Test Task 1');
	});

	test('should accept and parse .md files', async () => {
		const outputPath = path.join(tempDir, 'tasks-md.json');

		const result = await parsePRD(testFiles.md, outputPath, 2, {
			force: true,
			mcpLog: {
				info: vi.fn(),
				warn: vi.fn(),
				error: vi.fn(),
				debug: vi.fn(),
				success: vi.fn()
			},
			projectRoot: tempDir
		});

		expect(result.success).toBe(true);
		expect(result.tasksPath).toBe(outputPath);
		expect(fs.existsSync(outputPath)).toBe(true);

		// Verify the content was parsed correctly
		const tasksData = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
		expect(tasksData.master.tasks).toHaveLength(2);
	});

	test('should accept and parse files with other text extensions', async () => {
		const outputPath = path.join(tempDir, 'tasks-rst.json');

		const result = await parsePRD(testFiles.rst, outputPath, 2, {
			force: true,
			mcpLog: {
				info: vi.fn(),
				warn: vi.fn(),
				error: vi.fn(),
				debug: vi.fn(),
				success: vi.fn()
			},
			projectRoot: tempDir
		});

		expect(result.success).toBe(true);
		expect(result.tasksPath).toBe(outputPath);
		expect(fs.existsSync(outputPath)).toBe(true);
	});

	test('should accept and parse files with no extension', async () => {
		const outputPath = path.join(tempDir, 'tasks-noext.json');

		const result = await parsePRD(testFiles.noExt, outputPath, 2, {
			force: true,
			mcpLog: {
				info: vi.fn(),
				warn: vi.fn(),
				error: vi.fn(),
				debug: vi.fn(),
				success: vi.fn()
			},
			projectRoot: tempDir
		});

		expect(result.success).toBe(true);
		expect(result.tasksPath).toBe(outputPath);
		expect(fs.existsSync(outputPath)).toBe(true);
	});

	test('should produce identical results regardless of file extension', async () => {
		const outputs = {};

		// Parse each file type with a unique project root to avoid ID conflicts
		for (const [ext, filePath] of Object.entries(testFiles)) {
			// Create a unique subdirectory for each test to isolate them
			const testSubDir = path.join(tempDir, `test-${ext}`);
			fs.mkdirSync(testSubDir, { recursive: true });

			const outputPath = path.join(testSubDir, `tasks.json`);

			await parsePRD(filePath, outputPath, 2, {
				force: true,
				mcpLog: {
					info: vi.fn(),
					warn: vi.fn(),
					error: vi.fn(),
					debug: vi.fn(),
					success: vi.fn()
				},
				projectRoot: testSubDir
			});

			const tasksData = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
			outputs[ext] = tasksData;
		}

		// Compare all outputs - they should be identical (except metadata timestamps)
		const baseOutput = outputs.txt;
		Object.values(outputs).forEach((output) => {
			expect(output.master.tasks).toEqual(baseOutput.master.tasks);
			expect(output.master.metadata.projectName).toEqual(
				baseOutput.master.metadata.projectName
			);
			expect(output.master.metadata.totalTasks).toEqual(
				baseOutput.master.metadata.totalTasks
			);
		});
	});

	test('should handle non-existent files gracefully', async () => {
		const nonExistentFile = path.join(tempDir, 'does-not-exist.txt');
		const outputPath = path.join(tempDir, 'tasks-error.json');

		await expect(
			parsePRD(nonExistentFile, outputPath, 2, {
				force: true,
				mcpLog: {
					info: vi.fn(),
					warn: vi.fn(),
					error: vi.fn(),
					debug: vi.fn(),
					success: vi.fn()
				},
				projectRoot: tempDir
			})
		).rejects.toThrow();
	});
});
