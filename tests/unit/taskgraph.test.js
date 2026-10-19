/**
 * Tests for taskgraph.js initTaskGraph function
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { vi } from 'vitest';
import {
	TASKGRAPH_CONFIG_FILE,
	TASKGRAPH_DIR,
	TASKGRAPH_TASKS_FILE
} from '../../src/constants/paths.js';
import { TaskGraph, initTaskGraph } from '../../src/taskgraph.js';

// Mock the console to prevent noise during tests
vi.spyOn(console, 'error').mockImplementation(() => {});

describe('initTaskGraph', () => {
	let tempDir;
	let originalCwd;

	beforeEach(() => {
		// Create a temporary directory for testing
		tempDir = fs.realpathSync(
			fs.mkdtempSync(path.join(os.tmpdir(), 'taskgraph-test-'))
		);
		originalCwd = process.cwd();

		// Clear all mocks
		vi.clearAllMocks();
	});

	afterEach(() => {
		// Restore original working directory
		process.chdir(originalCwd);

		// Clean up temporary directory
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	describe('Project root detection', () => {
		test('should find project root when .taskgraph directory exists', () => {
			// Arrange - Create .taskgraph directory in temp dir
			const taskGraphDir = path.join(tempDir, TASKGRAPH_DIR);
			fs.mkdirSync(taskGraphDir, { recursive: true });

			// Change to temp directory
			process.chdir(tempDir);

			// Act
			const taskGraph = initTaskGraph({});

			// Assert
			expect(taskGraph.getProjectRoot()).toBe(tempDir);
			expect(taskGraph).toBeInstanceOf(TaskGraph);
		});

		test('should find project root from subdirectory', () => {
			// Arrange - Create .taskgraph directory in temp dir
			const taskGraphDir = path.join(tempDir, TASKGRAPH_DIR);
			fs.mkdirSync(taskGraphDir, { recursive: true });

			// Create a subdirectory and change to it
			const srcDir = path.join(tempDir, 'src');
			fs.mkdirSync(srcDir, { recursive: true });
			process.chdir(srcDir);

			// Act
			const taskGraph = initTaskGraph({});

			// Assert
			expect(taskGraph.getProjectRoot()).toBe(tempDir);
		});

		test('should find project root from deeply nested subdirectory', () => {
			// Arrange - Create .taskgraph directory and a boundary marker in temp dir
			// The boundary marker (.git) anchors .taskgraph to prevent false matches
			// from stray .taskgraph dirs (e.g., in home directory)
			const taskGraphDir = path.join(tempDir, TASKGRAPH_DIR);
			fs.mkdirSync(taskGraphDir, { recursive: true });
			fs.mkdirSync(path.join(tempDir, '.git'), { recursive: true });

			// Create deeply nested subdirectory and change to it
			const deepDir = path.join(tempDir, 'src', 'components', 'ui');
			fs.mkdirSync(deepDir, { recursive: true });
			process.chdir(deepDir);

			// Act
			const taskGraph = initTaskGraph({});

			// Assert
			expect(taskGraph.getProjectRoot()).toBe(tempDir);
		});

		test('should return cwd when no project markers found cuz we changed the behavior of this function', () => {
			// Arrange - Empty temp directory, no project markers
			process.chdir(tempDir);

			// Act
			const taskGraph = initTaskGraph({});

			// Assert
			expect(taskGraph.getProjectRoot()).toBe(tempDir);
		});
	});

	describe('Project root override validation', () => {
		test('should accept valid project root override with .taskgraph directory', () => {
			// Arrange - Create .taskgraph directory in temp dir
			const taskGraphDir = path.join(tempDir, TASKGRAPH_DIR);
			fs.mkdirSync(taskGraphDir, { recursive: true });

			// Act
			const taskGraph = initTaskGraph({ projectRoot: tempDir });

			// Assert
			expect(taskGraph.getProjectRoot()).toBe(tempDir);
		});

		test('should reject a project root override without a .taskgraph directory', () => {
			// Act & Assert
			expect(() => {
				initTaskGraph({ projectRoot: tempDir });
			}).toThrow('not a valid taskgraph project');
		});

		test('should throw error when project root override does not exist', () => {
			// Arrange - Non-existent path
			const nonExistentPath = path.join(tempDir, 'does-not-exist');

			// Act & Assert
			expect(() => {
				initTaskGraph({ projectRoot: nonExistentPath });
			}).toThrow(
				`Project root override path does not exist: ${nonExistentPath}`
			);
		});

		test('should throw error when project root override has no project markers', () => {
			// Arrange - Empty temp directory (no project markers)

			// Act & Assert
			expect(() => {
				initTaskGraph({ projectRoot: tempDir });
			}).toThrow(
				`Project root override is not a valid taskgraph project: ${tempDir}`
			);
		});

		test('should resolve relative project root override', () => {
			// Arrange - Create .taskgraph directory in temp dir
			const taskGraphDir = path.join(tempDir, TASKGRAPH_DIR);
			fs.mkdirSync(taskGraphDir, { recursive: true });

			// Create subdirectory and change to it
			const srcDir = path.join(tempDir, 'src');
			fs.mkdirSync(srcDir, { recursive: true });
			process.chdir(srcDir);

			// Act - Use relative path '../' to go back to project root
			const taskGraph = initTaskGraph({ projectRoot: '../' });

			// Assert
			expect(taskGraph.getProjectRoot()).toBe(tempDir);
		});
	});

	describe('Path resolution with boolean logic', () => {
		let taskGraphDir, tasksPath, configPath, statePath;

		beforeEach(() => {
			// Setup a valid project structure
			taskGraphDir = path.join(tempDir, TASKGRAPH_DIR);
			fs.mkdirSync(taskGraphDir, { recursive: true });

			tasksPath = path.join(tempDir, TASKGRAPH_TASKS_FILE);
			fs.mkdirSync(path.dirname(tasksPath), { recursive: true });
			fs.writeFileSync(tasksPath, '[]');

			configPath = path.join(tempDir, TASKGRAPH_CONFIG_FILE);
			fs.writeFileSync(configPath, '{}');

			statePath = path.join(taskGraphDir, 'state.json');
			fs.writeFileSync(statePath, '{}');

			process.chdir(tempDir);
		});

		test('should return paths when required (true) and files exist', () => {
			// Act
			const taskGraph = initTaskGraph({
				tasksPath: true,
				configPath: true,
				statePath: true
			});

			// Assert
			expect(taskGraph.getTasksPath()).toBe(tasksPath);
			expect(taskGraph.getConfigPath()).toBe(configPath);
			expect(taskGraph.getStatePath()).toBe(statePath);
		});

		test('should throw error when required (true) files do not exist', () => {
			// Arrange - Remove tasks file
			fs.unlinkSync(tasksPath);

			// Act & Assert
			expect(() => {
				initTaskGraph({ tasksPath: true });
			}).toThrow(
				'Required tasks file not found. Searched: .taskgraph/tasks/tasks.json'
			);
		});

		test('should return null when optional (false/undefined) files do not exist', () => {
			// Arrange - Remove tasks file
			fs.unlinkSync(tasksPath);

			// Act
			const taskGraph = initTaskGraph({
				tasksPath: false
			});

			// Assert
			expect(taskGraph.getTasksPath()).toBeNull();
		});

		test('should return default paths when optional files not specified in overrides', () => {
			// Arrange - Remove all optional files
			fs.unlinkSync(tasksPath);
			fs.unlinkSync(configPath);
			fs.unlinkSync(statePath);

			// Act - Don't specify any optional paths
			const taskGraph = initTaskGraph({});

			// Assert - Should return absolute paths with default locations
			expect(taskGraph.getTasksPath()).toBe(
				path.join(tempDir, TASKGRAPH_TASKS_FILE)
			);
			expect(taskGraph.getConfigPath()).toBe(
				path.join(tempDir, TASKGRAPH_CONFIG_FILE)
			);
			expect(taskGraph.getStatePath()).toBe(
				path.join(tempDir, TASKGRAPH_DIR, 'state.json')
			);
		});
	});

	describe('String path overrides', () => {
		let taskGraphDir;

		beforeEach(() => {
			taskGraphDir = path.join(tempDir, TASKGRAPH_DIR);
			fs.mkdirSync(taskGraphDir, { recursive: true });
			process.chdir(tempDir);
		});

		test('should accept valid absolute path override', () => {
			// Arrange - Create custom tasks file
			const customTasksPath = path.join(tempDir, 'custom-tasks.json');
			fs.writeFileSync(customTasksPath, '[]');

			// Act
			const taskGraph = initTaskGraph({
				tasksPath: customTasksPath
			});

			// Assert
			expect(taskGraph.getTasksPath()).toBe(customTasksPath);
		});

		test('should accept valid relative path override', () => {
			// Arrange - Create custom tasks file
			const customTasksPath = path.join(tempDir, 'custom-tasks.json');
			fs.writeFileSync(customTasksPath, '[]');

			// Act
			const taskGraph = initTaskGraph({
				tasksPath: './custom-tasks.json'
			});

			// Assert
			expect(taskGraph.getTasksPath()).toBe(customTasksPath);
		});

		test('should throw error when string path override does not exist', () => {
			// Arrange - Non-existent file path
			const nonExistentPath = path.join(tempDir, 'does-not-exist.json');

			// Act & Assert
			expect(() => {
				initTaskGraph({ tasksPath: nonExistentPath });
			}).toThrow(`tasks file override path does not exist: ${nonExistentPath}`);
		});
	});

	describe('Legacy file support', () => {
		beforeEach(() => {
			// Setup basic project structure
			const taskGraphDir = path.join(tempDir, TASKGRAPH_DIR);
			fs.mkdirSync(taskGraphDir, { recursive: true });
			process.chdir(tempDir);
		});

		test('should find the tasks file in the .taskgraph directory', () => {
			// Arrange
			const newTasksPath = path.join(tempDir, TASKGRAPH_TASKS_FILE);
			fs.mkdirSync(path.dirname(newTasksPath), { recursive: true });
			fs.writeFileSync(newTasksPath, '[]');

			// Act
			const taskGraph = initTaskGraph({ tasksPath: true });

			// Assert
			expect(taskGraph.getTasksPath()).toBe(newTasksPath);
		});
	});

	describe('TaskGraph class methods', () => {
		test('should return all paths via getAllPaths method', () => {
			// Arrange - Setup project with all files
			const taskGraphDir = path.join(tempDir, TASKGRAPH_DIR);
			fs.mkdirSync(taskGraphDir, { recursive: true });

			const tasksPath = path.join(tempDir, TASKGRAPH_TASKS_FILE);
			fs.mkdirSync(path.dirname(tasksPath), { recursive: true });
			fs.writeFileSync(tasksPath, '[]');

			const configPath = path.join(tempDir, TASKGRAPH_CONFIG_FILE);
			fs.writeFileSync(configPath, '{}');

			process.chdir(tempDir);

			// Act
			const taskGraph = initTaskGraph({
				tasksPath: true,
				configPath: true
			});

			// Assert
			const allPaths = taskGraph.getAllPaths();
			expect(allPaths).toEqual(
				expect.objectContaining({
					projectRoot: tempDir,
					taskGraphDir: taskGraphDir,
					tasksPath: tasksPath,
					configPath: configPath
				})
			);

			// Verify paths object is frozen
			expect(() => {
				allPaths.projectRoot = '/different/path';
			}).toThrow();
		});

		test('should return correct individual paths', () => {
			// Arrange
			const taskGraphDir = path.join(tempDir, TASKGRAPH_DIR);
			fs.mkdirSync(taskGraphDir, { recursive: true });
			process.chdir(tempDir);

			// Act
			const taskGraph = initTaskGraph({});

			// Assert
			expect(taskGraph.getProjectRoot()).toBe(tempDir);
			expect(taskGraph.getTaskGraphDir()).toBe(taskGraphDir);
			// Default paths are always set for tasks, config, and state
			expect(taskGraph.getTasksPath()).toBe(
				path.join(tempDir, TASKGRAPH_TASKS_FILE)
			);
			expect(taskGraph.getConfigPath()).toBe(
				path.join(tempDir, TASKGRAPH_CONFIG_FILE)
			);
			expect(taskGraph.getStatePath()).toBe(
				path.join(taskGraphDir, 'state.json')
			);
			// PRD and complexity report paths are undefined when not provided
			expect(typeof taskGraph.getComplexityReportPath()).toBe('string');
			expect(taskGraph.getComplexityReportPath()).toMatch(
				/task-complexity-report\.json$/
			);
		});
	});
});
