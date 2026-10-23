/**
 * Unit test to ensure fixDependenciesCommand writes JSON with the correct
 * projectRoot and tag arguments so that tag data is preserved.
 */

import { vi } from 'vitest';

// Mock process.exit to prevent test termination
const mockProcessExit = vi.fn();
const originalExit = process.exit;
process.exit = mockProcessExit;

// Mock utils.js BEFORE importing the module under test
vi.doMock('../../../../../scripts/modules/utils.js', () => ({
	readJSON: vi.fn(),
	writeJSON: vi.fn(),
	log: vi.fn(),
	findProjectRoot: vi.fn(() => '/mock/project/root'),
	getCurrentTag: vi.fn(() => 'master'),
	taskExists: vi.fn(() => true),
	formatTaskId: vi.fn((id) => id),
	findCycles: vi.fn(() => []),
	traverseDependencies: vi.fn((sourceTasks, allTasks, options = {}) => []),
	isSilentMode: vi.fn(() => true),
	resolveTag: vi.fn(() => 'master'),
	getTasksForTag: vi.fn(() => []),
	enableSilentMode: vi.fn(),
	disableSilentMode: vi.fn(),
	isEmpty: vi.fn((value) => {
		if (value === null || value === undefined) return true;
		if (Array.isArray(value)) return value.length === 0;
		if (typeof value === 'object' && value !== null)
			return Object.keys(value).length === 0;
		return false; // Not an array or object
	}),
	resolveEnvVariable: vi.fn()
}));

// Mock ui.js
vi.doMock('../../../../../scripts/modules/ui.js', () => ({
	displayBanner: vi.fn(),
	formatDependenciesWithStatus: vi.fn()
}));

// Mock task-manager.js
// Mock external libraries
vi.doMock('chalk', () => ({
	default: {
		green: vi.fn((text) => text),
		cyan: vi.fn((text) => text),
		bold: vi.fn((text) => text)
	}
}));

// Import the mocked modules
const { readJSON, writeJSON, log, taskExists } = await import(
	'../../../../../scripts/modules/utils.js'
);

// Import the module under test
const { fixDependenciesCommand } = await import(
	'../../../../../scripts/modules/dependency-manager.js'
);

describe('fixDependenciesCommand tag preservation', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockProcessExit.mockClear();
	});

	afterAll(() => {
		// Restore original process.exit
		process.exit = originalExit;
	});

	it('calls writeJSON with projectRoot and tag parameters when changes are made', async () => {
		const tasksPath = '/mock/tasks.json';
		const projectRoot = '/mock/project/root';
		const tag = 'master';

		// Mock data WITH dependency issues to trigger writeJSON
		const tasksDataWithIssues = {
			tasks: [
				{
					id: 1,
					title: 'Task 1',
					dependencies: [999] // Non-existent dependency to trigger fix
				},
				{
					id: 2,
					title: 'Task 2',
					dependencies: []
				}
			],
			tag: 'master',
			_rawTaggedData: {
				master: {
					tasks: [
						{
							id: 1,
							title: 'Task 1',
							dependencies: [999]
						}
					]
				}
			}
		};

		readJSON.mockReturnValue(tasksDataWithIssues);
		taskExists.mockReturnValue(false); // Make dependency invalid to trigger fix

		await fixDependenciesCommand(tasksPath, {
			context: { projectRoot, tag }
		});

		// Verify readJSON was called with correct parameters
		expect(readJSON).toHaveBeenCalledWith(tasksPath, projectRoot, tag);

		// Verify writeJSON was called (should be triggered by removing invalid dependency)
		expect(writeJSON).toHaveBeenCalled();

		// Check the writeJSON call parameters
		const writeJSONCalls = writeJSON.mock.calls;
		const lastWriteCall = writeJSONCalls[writeJSONCalls.length - 1];
		const [calledPath, _data, calledProjectRoot, calledTag] = lastWriteCall;

		expect(calledPath).toBe(tasksPath);
		expect(calledProjectRoot).toBe(projectRoot);
		expect(calledTag).toBe(tag);

		// Verify process.exit was NOT called (meaning the function succeeded)
		expect(mockProcessExit).not.toHaveBeenCalled();
	});

	it('does not call writeJSON when no changes are needed', async () => {
		const tasksPath = '/mock/tasks.json';
		const projectRoot = '/mock/project/root';
		const tag = 'master';

		// Mock data WITHOUT dependency issues (no changes needed)
		const cleanTasksData = {
			tasks: [
				{
					id: 1,
					title: 'Task 1',
					dependencies: [] // Clean, no issues
				}
			],
			tag: 'master'
		};

		readJSON.mockReturnValue(cleanTasksData);
		taskExists.mockReturnValue(true); // All dependencies exist

		await fixDependenciesCommand(tasksPath, {
			context: { projectRoot, tag }
		});

		// Verify readJSON was called
		expect(readJSON).toHaveBeenCalledWith(tasksPath, projectRoot, tag);

		// Verify writeJSON was NOT called (no changes needed)
		expect(writeJSON).not.toHaveBeenCalled();

		// Verify process.exit was NOT called
		expect(mockProcessExit).not.toHaveBeenCalled();
	});

	it('throws NO_TASKS instead of exiting when no valid tasks found', async () => {
		const tasksPath = '/mock/tasks.json';

		readJSON.mockReturnValue(null);

		await expect(
			fixDependenciesCommand(tasksPath, {
				context: { projectRoot: '/mock', tag: 'master' }
			})
		).rejects.toMatchObject({ code: 'NO_TASKS' });

		expect(readJSON).toHaveBeenCalled();
		expect(writeJSON).not.toHaveBeenCalled();
		expect(mockProcessExit).not.toHaveBeenCalled();
	});
});
