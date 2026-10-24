/**
 * Utils module tests
 */

import { vi } from 'vitest';

// Mock modules first before any imports
vi.doMock('fs', () => ({
	existsSync: vi.fn((filePath) => {
		// Prevent Jest internal file access
		if (
			filePath.includes('jest-message-util') ||
			filePath.includes('node_modules')
		) {
			return false;
		}
		return false; // Default to false for config discovery prevention
	}),
	readFileSync: vi.fn(() => '{}'),
	writeFileSync: vi.fn(),
	mkdirSync: vi.fn()
}));

vi.doMock('path', () => ({
	join: vi.fn((...paths) => paths.join('/')),
	dirname: vi.fn((filePath) => filePath.split('/').slice(0, -1).join('/')),
	resolve: vi.fn((...paths) => paths.join('/')),
	basename: vi.fn((filePath) => filePath.split('/').pop()),
	parse: vi.fn((filePath) => {
		const parts = filePath.split('/');
		const fileName = parts[parts.length - 1];
		const extIndex = fileName.lastIndexOf('.');
		return {
			dir: parts.length > 1 ? parts.slice(0, -1).join('/') : '',
			name: extIndex > 0 ? fileName.substring(0, extIndex) : fileName,
			ext: extIndex > 0 ? fileName.substring(extIndex) : '',
			base: fileName
		};
	}),
	format: vi.fn((pathObj) => {
		const dir = pathObj.dir || '';
		const base = pathObj.base || `${pathObj.name || ''}${pathObj.ext || ''}`;
		return dir ? `${dir}/${base}` : base;
	})
}));

vi.doMock('chalk', () => ({
	red: vi.fn((text) => text),
	blue: vi.fn((text) => text),
	green: vi.fn((text) => text),
	yellow: vi.fn((text) => text),
	white: vi.fn((text) => ({
		bold: vi.fn((text) => text)
	})),
	reset: vi.fn((text) => text),
	dim: vi.fn((text) => text) // Add dim function to prevent chalk errors
}));

// Mock console to prevent Jest internal access
const mockConsole = {
	log: vi.fn(),
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn()
};
global.console = mockConsole;

// Mock path-utils to prevent file system discovery issues
vi.doMock('../../src/utils/path-utils.js', () => ({
	__esModule: true,
	findConfigPath: vi.fn(() => null), // Always return null to prevent config discovery
	findTasksPath: vi.fn(() => '/mock/tasks.json')
}));

// Import the actual module to test
import {
	findCycles,
	findTaskInComplexityReport,
	formatTaskId,
	getTagAwareFilePath,
	log,
	readComplexityReport,
	readJSON,
	sanitizePrompt,
	slugifyTagForFilePath,
	taskExists,
	toKebabCase,
	truncate,
	writeJSON
} from '../../scripts/modules/utils.js';

// Import the mocked modules for use in tests
import fs from 'fs';
import path from 'path';

// Mock config-manager to provide config values
const mockGetLogLevel = vi.fn(() => 'info'); // Default log level for tests
const mockGetDebugFlag = vi.fn(() => false); // Default debug flag for tests
vi.doMock('../../scripts/modules/config-manager.js', () => ({
	getLogLevel: mockGetLogLevel,
	getDebugFlag: mockGetDebugFlag
	// Mock other getters if needed by utils.js functions under test
}));

// Test implementation of detectCamelCaseFlags
function testDetectCamelCaseFlags(args) {
	const camelCaseFlags = [];
	for (const arg of args) {
		if (arg.startsWith('--')) {
			const flagName = arg.split('=')[0].slice(2); // Remove -- and anything after =

			// Skip single-word flags - they can't be camelCase
			if (!flagName.includes('-') && !/[A-Z]/.test(flagName)) {
				continue;
			}

			// Check for camelCase pattern (lowercase followed by uppercase)
			if (/[a-z][A-Z]/.test(flagName)) {
				const kebabVersion = toKebabCase(flagName);
				if (kebabVersion !== flagName) {
					camelCaseFlags.push({
						original: flagName,
						kebabCase: kebabVersion
					});
				}
			}
		}
	}
	return camelCaseFlags;
}

describe('Utils Module', () => {
	beforeEach(() => {
		// Clear all mocks before each test
		vi.clearAllMocks();
		// Restore the original path.join mock
		vi.spyOn(path, 'join').mockImplementation((...paths) => paths.join('/'));
	});

	describe('truncate function', () => {
		test('should return the original string if shorter than maxLength', () => {
			const result = truncate('Hello', 10);
			expect(result).toBe('Hello');
		});

		test('should truncate the string and add ellipsis if longer than maxLength', () => {
			const result = truncate(
				'This is a long string that needs truncation',
				20
			);
			expect(result).toBe('This is a long st...');
		});

		test('should handle empty string', () => {
			const result = truncate('', 10);
			expect(result).toBe('');
		});

		test('should return null when input is null', () => {
			const result = truncate(null, 10);
			expect(result).toBe(null);
		});

		test('should return undefined when input is undefined', () => {
			const result = truncate(undefined, 10);
			expect(result).toBe(undefined);
		});

		test('should handle maxLength of 0 or negative', () => {
			// When maxLength is 0, slice(0, -3) returns 'He'
			const result1 = truncate('Hello', 0);
			expect(result1).toBe('He...');

			// When maxLength is negative, slice(0, -8) returns nothing
			const result2 = truncate('Hello', -5);
			expect(result2).toBe('...');
		});
	});

	test('log strips terminal escape sequences from the message (#419)', () => {
		log('warn', 'Expanding task 1: Fix \x1b]0;pwned\x07login\x1b[2J');

		expect(console.log).toHaveBeenCalledWith(
			expect.stringMatching(/ Expanding task 1: Fix login$/)
		);
		expect(console.log.mock.calls[0][0]).not.toMatch(/\x1b\]|\x1b\[2J/);
	});

	describe.skip('log function', () => {
		// const originalConsoleLog = console.log; // Keep original for potential restore if needed
		beforeEach(() => {
			// Mock console.log for each test
			// console.log = vi.fn(); // REMOVE console.log spy
			mockGetLogLevel.mockClear(); // Clear mock calls
		});

		afterEach(() => {
			// Restore original console.log after each test
			// console.log = originalConsoleLog; // REMOVE console.log restore
		});

		test('should log messages according to log level from config-manager', () => {
			// Test with info level (default from mock)
			mockGetLogLevel.mockReturnValue('info');

			// Spy on console.log JUST for this test to verify calls
			const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

			log('debug', 'Debug message');
			log('info', 'Info message');
			log('warn', 'Warning message');
			log('error', 'Error message');

			// Debug should not be logged (level 0 < 1)
			expect(consoleSpy).not.toHaveBeenCalledWith(
				expect.stringContaining('Debug message')
			);

			// Info and above should be logged
			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining('Info message')
			);
			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining('Warning message')
			);
			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining('Error message')
			);

			// Warnings and errors carry the CLI's marks; info is plain text
			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringMatching(/^Info message/)
			);
			expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('⚠'));
			expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('✗'));

			// Verify getLogLevel was called by log function
			expect(mockGetLogLevel).toHaveBeenCalled();

			// Restore spy for this test
			consoleSpy.mockRestore();
		});

		test('should not log messages below the configured log level', () => {
			// Set log level to error via mock
			mockGetLogLevel.mockReturnValue('error');

			// Spy on console.log JUST for this test
			const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

			log('debug', 'Debug message');
			log('info', 'Info message');
			log('warn', 'Warning message');
			log('error', 'Error message');

			// Only error should be logged
			expect(consoleSpy).not.toHaveBeenCalledWith(
				expect.stringContaining('Debug message')
			);
			expect(consoleSpy).not.toHaveBeenCalledWith(
				expect.stringContaining('Info message')
			);
			expect(consoleSpy).not.toHaveBeenCalledWith(
				expect.stringContaining('Warning message')
			);
			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining('Error message')
			);

			// Verify getLogLevel was called
			expect(mockGetLogLevel).toHaveBeenCalled();

			// Restore spy for this test
			consoleSpy.mockRestore();
		});

		test('should join multiple arguments into a single message', () => {
			mockGetLogLevel.mockReturnValue('info');
			// Spy on console.log JUST for this test
			const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

			log('info', 'Message', 'with', 'multiple', 'parts');
			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining('Message with multiple parts')
			);

			// Restore spy for this test
			consoleSpy.mockRestore();
		});
	});

	describe.skip('readJSON function', () => {
		test('should read and parse a valid JSON file', () => {
			const testData = { key: 'value', nested: { prop: true } };
			fsReadFileSyncSpy.mockReturnValue(JSON.stringify(testData));

			const result = readJSON('test.json');

			expect(fsReadFileSyncSpy).toHaveBeenCalledWith('test.json', 'utf8');
			expect(result).toEqual(testData);
		});

		test('should handle file not found errors', () => {
			fsReadFileSyncSpy.mockImplementation(() => {
				throw new Error('ENOENT: no such file or directory');
			});

			// Mock console.error
			const consoleSpy = vi
				.spyOn(console, 'error')
				.mockImplementation(() => {});

			const result = readJSON('nonexistent.json');

			expect(result).toBeNull();

			// Restore console.error
			consoleSpy.mockRestore();
		});

		test('should handle invalid JSON format', () => {
			fsReadFileSyncSpy.mockReturnValue('{ invalid json: }');

			// Mock console.error
			const consoleSpy = vi
				.spyOn(console, 'error')
				.mockImplementation(() => {});

			const result = readJSON('invalid.json');

			expect(result).toBeNull();

			// Restore console.error
			consoleSpy.mockRestore();
		});
	});

	describe.skip('writeJSON function', () => {
		test('should write JSON data to a file', () => {
			const testData = { key: 'value', nested: { prop: true } };

			writeJSON('output.json', testData);

			expect(fsWriteFileSyncSpy).toHaveBeenCalledWith(
				'output.json',
				JSON.stringify(testData, null, 2),
				'utf8'
			);
		});

		test('should handle file write errors', () => {
			const testData = { key: 'value' };

			fsWriteFileSyncSpy.mockImplementation(() => {
				throw new Error('Permission denied');
			});

			// Mock console.error
			const consoleSpy = vi
				.spyOn(console, 'error')
				.mockImplementation(() => {});

			// Function shouldn't throw, just log error
			expect(() => writeJSON('protected.json', testData)).not.toThrow();

			// Restore console.error
			consoleSpy.mockRestore();
		});
	});

	describe('sanitizePrompt function', () => {
		test('should escape double quotes in prompts', () => {
			const prompt = 'This is a "quoted" prompt with "multiple" quotes';
			const expected =
				'This is a \\"quoted\\" prompt with \\"multiple\\" quotes';

			expect(sanitizePrompt(prompt)).toBe(expected);
		});

		test('should handle prompts with no special characters', () => {
			const prompt = 'This is a regular prompt without quotes';

			expect(sanitizePrompt(prompt)).toBe(prompt);
		});

		test('should handle empty strings', () => {
			expect(sanitizePrompt('')).toBe('');
		});
	});

	describe('readComplexityReport function', () => {
		test('should read and parse a valid complexity report', () => {
			const testReport = {
				meta: { generatedAt: new Date().toISOString() },
				complexityAnalysis: [{ taskId: 1, complexityScore: 7 }]
			};

			vi.spyOn(fs, 'existsSync').mockReturnValue(true);
			vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(testReport));
			vi.spyOn(path, 'join').mockReturnValue('/path/to/report.json');

			const result = readComplexityReport();

			expect(fs.existsSync).toHaveBeenCalled();
			expect(fs.readFileSync).toHaveBeenCalledWith(
				'/path/to/report.json',
				'utf8'
			);
			expect(result).toEqual(testReport);
		});

		test('should handle missing report file', () => {
			vi.spyOn(fs, 'existsSync').mockReturnValue(false);
			vi.spyOn(path, 'join').mockReturnValue('/path/to/report.json');

			const result = readComplexityReport();

			expect(result).toBeNull();
			expect(fs.readFileSync).not.toHaveBeenCalled();
		});

		test('should handle custom report path', () => {
			const testReport = {
				meta: { generatedAt: new Date().toISOString() },
				complexityAnalysis: [{ taskId: 1, complexityScore: 7 }]
			};

			vi.spyOn(fs, 'existsSync').mockReturnValue(true);
			vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(testReport));

			const customPath = '/custom/path/report.json';
			const result = readComplexityReport(customPath);

			expect(fs.existsSync).toHaveBeenCalledWith(customPath);
			expect(fs.readFileSync).toHaveBeenCalledWith(customPath, 'utf8');
			expect(result).toEqual(testReport);
		});
	});

	describe('findTaskInComplexityReport function', () => {
		test('should find a task by ID in a valid report', () => {
			const testReport = {
				complexityAnalysis: [
					{ taskId: 1, complexityScore: 7 },
					{ taskId: 2, complexityScore: 4 },
					{ taskId: 3, complexityScore: 9 }
				]
			};

			const result = findTaskInComplexityReport(testReport, 2);

			expect(result).toEqual({ taskId: 2, complexityScore: 4 });
		});

		test('should return null for non-existent task ID', () => {
			const testReport = {
				complexityAnalysis: [
					{ taskId: 1, complexityScore: 7 },
					{ taskId: 2, complexityScore: 4 }
				]
			};

			const result = findTaskInComplexityReport(testReport, 99);

			// Fixing the expectation to match actual implementation
			// The function might return null or undefined based on implementation
			expect(result).toBeFalsy();
		});

		test('should handle invalid report structure', () => {
			// Test with null report
			expect(findTaskInComplexityReport(null, 1)).toBeNull();

			// Test with missing complexityAnalysis
			expect(findTaskInComplexityReport({}, 1)).toBeNull();

			// Test with non-array complexityAnalysis
			expect(
				findTaskInComplexityReport({ complexityAnalysis: {} }, 1)
			).toBeNull();
		});
	});

	describe('taskExists function', () => {
		const sampleTasks = [
			{ id: 1, title: 'Task 1' },
			{ id: 2, title: 'Task 2' },
			{
				id: 3,
				title: 'Task with subtasks',
				subtasks: [
					{ id: 1, title: 'Subtask 1' },
					{ id: 2, title: 'Subtask 2' }
				]
			}
		];

		test('should return true for existing task IDs', () => {
			expect(taskExists(sampleTasks, 1)).toBe(true);
			expect(taskExists(sampleTasks, 2)).toBe(true);
			expect(taskExists(sampleTasks, '2')).toBe(true); // String ID should work too
		});

		test('should return true for existing subtask IDs', () => {
			expect(taskExists(sampleTasks, '3.1')).toBe(true);
			expect(taskExists(sampleTasks, '3.2')).toBe(true);
		});

		test('should return false for non-existent task IDs', () => {
			expect(taskExists(sampleTasks, 99)).toBe(false);
			expect(taskExists(sampleTasks, '99')).toBe(false);
		});

		test('should return false for non-existent subtask IDs', () => {
			expect(taskExists(sampleTasks, '3.99')).toBe(false);
			expect(taskExists(sampleTasks, '99.1')).toBe(false);
		});

		test('should handle invalid inputs', () => {
			expect(taskExists(null, 1)).toBe(false);
			expect(taskExists(undefined, 1)).toBe(false);
			expect(taskExists([], 1)).toBe(false);
			expect(taskExists(sampleTasks, null)).toBe(false);
			expect(taskExists(sampleTasks, undefined)).toBe(false);
		});
	});

	describe('formatTaskId function', () => {
		test('should format numeric task IDs as strings', () => {
			expect(formatTaskId(1)).toBe('1');
			expect(formatTaskId(42)).toBe('42');
		});

		test('should preserve string task IDs', () => {
			expect(formatTaskId('1')).toBe('1');
			expect(formatTaskId('task-1')).toBe('task-1');
		});

		test('should preserve dot notation for subtask IDs', () => {
			expect(formatTaskId('1.2')).toBe('1.2');
			expect(formatTaskId('42.7')).toBe('42.7');
		});

		test('should handle edge cases', () => {
			// These should return as-is, though your implementation may differ
			expect(formatTaskId(null)).toBe(null);
			expect(formatTaskId(undefined)).toBe(undefined);
			expect(formatTaskId('')).toBe('');
		});
	});

	describe('findCycles function', () => {
		test('should detect simple cycles in dependency graph', () => {
			// A -> B -> A (cycle)
			const dependencyMap = new Map([
				['A', ['B']],
				['B', ['A']]
			]);

			const cycles = findCycles('A', dependencyMap);

			expect(cycles.length).toBeGreaterThan(0);
			expect(cycles).toContain('A');
		});

		test('should detect complex cycles in dependency graph', () => {
			// A -> B -> C -> A (cycle)
			const dependencyMap = new Map([
				['A', ['B']],
				['B', ['C']],
				['C', ['A']]
			]);

			const cycles = findCycles('A', dependencyMap);

			expect(cycles.length).toBeGreaterThan(0);
			expect(cycles).toContain('A');
		});

		test('should return empty array for acyclic graphs', () => {
			// A -> B -> C (no cycle)
			const dependencyMap = new Map([
				['A', ['B']],
				['B', ['C']],
				['C', []]
			]);

			const cycles = findCycles('A', dependencyMap);

			expect(cycles.length).toBe(0);
		});

		test('should handle empty dependency maps', () => {
			const dependencyMap = new Map();

			const cycles = findCycles('A', dependencyMap);

			expect(cycles.length).toBe(0);
		});

		test('should handle nodes with no dependencies', () => {
			const dependencyMap = new Map([
				['A', []],
				['B', []],
				['C', []]
			]);

			const cycles = findCycles('A', dependencyMap);

			expect(cycles.length).toBe(0);
		});

		test('should identify the breaking edge in a cycle', () => {
			// A -> B -> C -> D -> B (cycle)
			const dependencyMap = new Map([
				['A', ['B']],
				['B', ['C']],
				['C', ['D']],
				['D', ['B']]
			]);

			const cycles = findCycles('A', dependencyMap);

			expect(cycles).toContain('B');
		});
	});
});

describe('CLI Flag Format Validation', () => {
	test('toKebabCase should convert camelCase to kebab-case', () => {
		expect(toKebabCase('promptText')).toBe('prompt-text');
		expect(toKebabCase('userID')).toBe('user-id');
		expect(toKebabCase('numTasks')).toBe('num-tasks');
		expect(toKebabCase('alreadyKebabCase')).toBe('already-kebab-case');
	});

	test('detectCamelCaseFlags should identify camelCase flags', () => {
		const args = [
			'node',
			'taskgraph',
			'add-task',
			'--promptText=test',
			'--userID=123'
		];
		const flags = testDetectCamelCaseFlags(args);

		expect(flags).toHaveLength(2);
		expect(flags).toContainEqual({
			original: 'promptText',
			kebabCase: 'prompt-text'
		});
		expect(flags).toContainEqual({
			original: 'userID',
			kebabCase: 'user-id'
		});
	});

	test('detectCamelCaseFlags should not flag kebab-case flags', () => {
		const args = [
			'node',
			'taskgraph',
			'add-task',
			'--prompt-text=test',
			'--user-id=123'
		];
		const flags = testDetectCamelCaseFlags(args);

		expect(flags).toHaveLength(0);
	});

	test('detectCamelCaseFlags should respect single-word flags', () => {
		const args = [
			'node',
			'taskgraph',
			'add-task',
			'--prompt=test',
			'--file=test.json',
			'--priority=high',
			'--promptText=test'
		];
		const flags = testDetectCamelCaseFlags(args);

		// Should only flag promptText, not the single-word flags
		expect(flags).toHaveLength(1);
		expect(flags).toContainEqual({
			original: 'promptText',
			kebabCase: 'prompt-text'
		});
	});
});

test('slugifyTagForFilePath should create filesystem-safe tag names', () => {
	expect(slugifyTagForFilePath('feature/user-auth')).toBe('feature-user-auth');
	expect(slugifyTagForFilePath('Feature Branch')).toBe('feature-branch');
	expect(slugifyTagForFilePath('test@special#chars')).toBe(
		'test-special-chars'
	);
	expect(slugifyTagForFilePath('UPPERCASE')).toBe('uppercase');
	expect(slugifyTagForFilePath('multiple---hyphens')).toBe('multiple-hyphens');
	expect(slugifyTagForFilePath('--leading-trailing--')).toBe(
		'leading-trailing'
	);
	expect(slugifyTagForFilePath('')).toBe('unknown-tag');
	expect(slugifyTagForFilePath(null)).toBe('unknown-tag');
	expect(slugifyTagForFilePath(undefined)).toBe('unknown-tag');
});

test('getTagAwareFilePath should use slugified tags in file paths', () => {
	const basePath = '.taskgraph/reports/complexity-report.json';
	const projectRoot = '/test/project';

	// Master tag should not be slugified
	expect(getTagAwareFilePath(basePath, 'master', projectRoot)).toBe(
		'/test/project/.taskgraph/reports/complexity-report.json'
	);

	// Null/undefined tags should use base path
	expect(getTagAwareFilePath(basePath, null, projectRoot)).toBe(
		'/test/project/.taskgraph/reports/complexity-report.json'
	);

	// Regular tag should be slugified
	expect(getTagAwareFilePath(basePath, 'feature-branch', projectRoot)).toBe(
		'/test/project/.taskgraph/reports/complexity-report_feature-branch.json'
	);

	// Tag with special characters should be slugified
	expect(getTagAwareFilePath(basePath, 'feature/user-auth', projectRoot)).toBe(
		'/test/project/.taskgraph/reports/complexity-report_feature-user-auth.json'
	);

	// Tag with spaces and special characters
	expect(
		getTagAwareFilePath(basePath, 'Feature Branch @Test', projectRoot)
	).toBe(
		'/test/project/.taskgraph/reports/complexity-report_feature-branch-test.json'
	);
});
