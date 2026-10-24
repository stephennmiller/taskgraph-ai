import { vi } from 'vitest';

vi.doMock('../../../../../scripts/modules/utils.js', () => ({
	findProjectRoot: vi.fn(() => '/test/project/root'),
	log: vi.fn(),
	readJSON: vi.fn(),
	writeJSON: vi.fn(),
	flattenTasksWithSubtasks: vi.fn(() => []),
	isEmpty: vi.fn(() => false)
}));

// Mock UI-affecting external libs to minimal no-op implementations
vi.doMock('chalk', () => ({
	// Callable like the real chalk: theme.text is plain chalk
	default: Object.assign(
		vi.fn((text) => text),
		{
			bold: vi.fn((text) => text),
			italic: vi.fn((text) => text),
			magenta: vi.fn((text) => text),
			white: Object.assign(
				vi.fn((text) => text),
				{
					bold: vi.fn((text) => text)
				}
			),
			cyan: Object.assign(
				vi.fn((text) => text),
				{
					bold: vi.fn((text) => text)
				}
			),
			green: Object.assign(
				vi.fn((text) => text),
				{
					bold: vi.fn((text) => text)
				}
			),
			yellow: vi.fn((text) => text),
			red: vi.fn((text) => text),
			dim: Object.assign(
				vi.fn((text) => text),
				{
					italic: vi.fn((text) => text)
				}
			),
			blue: Object.assign(
				vi.fn((text) => text),
				{
					bold: vi.fn((text) => text),
					underline: vi.fn((text) => text)
				}
			),
			dim: Object.assign(
				vi.fn((text) => text),
				{
					strikethrough: vi.fn((text) => text)
				}
			)
		}
	)
}));

vi.doMock('inquirer', () => ({
	default: { prompt: vi.fn() }
}));

vi.doMock('cli-table3', () => ({
	default: vi.fn().mockImplementation(() => ({
		push: vi.fn(),
		toString: vi.fn(() => '')
	}))
}));

vi.doMock('../../../../../scripts/modules/utils/contextGatherer.js', () => ({
	ContextGatherer: vi.fn().mockImplementation(() => ({
		gather: vi.fn().mockResolvedValue({
			context: 'Gathered context',
			tokenBreakdown: { total: 500 }
		}),
		countTokens: vi.fn(() => 100)
	}))
}));

vi.doMock('../../../../../scripts/modules/utils/fuzzyTaskSearch.js', () => ({
	FuzzyTaskSearch: vi.fn().mockImplementation(() => ({
		findRelevantTasks: vi.fn(() => []),
		getTaskIds: vi.fn(() => [])
	}))
}));

vi.doMock('../../../../../scripts/modules/ai-services-unified.js', () => ({
	generateTextService: vi.fn().mockResolvedValue({
		mainResult:
			'Test research result with ```javascript\nconsole.log("test");\n```',
		telemetryData: {}
	}),
	streamTextService: vi.fn().mockResolvedValue({
		mainResult: {
			textStream: (async function* () {
				yield 'Test research result';
			})()
		},
		telemetryData: {}
	})
}));

vi.doMock('../../../../../scripts/modules/ui.js', () => ({
	displayAiUsageSummary: vi.fn(),
	startLoadingIndicator: vi.fn(() => ({ stop: vi.fn() })),
	stopLoadingIndicator: vi.fn()
}));

vi.doMock('../../../../../scripts/modules/prompt-manager.js', () => ({
	getPromptManager: vi.fn().mockReturnValue({
		loadPrompt: vi.fn().mockResolvedValue({
			systemPrompt: 'System prompt',
			userPrompt: 'User prompt'
		})
	})
}));

const { appendResearchToTask, performResearch } = await import(
	'../../../../../scripts/modules/task-manager/research.js'
);

// Import mocked modules for testing
const utils = await import('../../../../../scripts/modules/utils.js');
const { ContextGatherer } = await import(
	'../../../../../scripts/modules/utils/contextGatherer.js'
);
const { FuzzyTaskSearch } = await import(
	'../../../../../scripts/modules/utils/fuzzyTaskSearch.js'
);
const { generateTextService } = await import(
	'../../../../../scripts/modules/ai-services-unified.js'
);

describe('performResearch project root validation', () => {
	it('throws error when project root cannot be determined', async () => {
		// Mock findProjectRoot to return null
		utils.findProjectRoot.mockReturnValueOnce(null);

		await expect(
			performResearch('Test query', {}, {}, 'json', false)
		).rejects.toThrow('Could not determine project root directory');
	});
});

describe('performResearch tag-aware functionality', () => {
	let mockContextGatherer;
	let mockFuzzySearch;
	let mockReadJSON;
	let mockFlattenTasks;

	beforeEach(() => {
		// Reset all mocks
		vi.clearAllMocks();

		// Set up default mocks
		utils.findProjectRoot.mockReturnValue('/test/project/root');
		utils.readJSON.mockResolvedValue({
			tasks: [
				{ id: 1, title: 'Task 1', description: 'Description 1' },
				{ id: 2, title: 'Task 2', description: 'Description 2' }
			]
		});
		utils.flattenTasksWithSubtasks.mockReturnValue([
			{ id: 1, title: 'Task 1', description: 'Description 1' },
			{ id: 2, title: 'Task 2', description: 'Description 2' }
		]);

		// Set up ContextGatherer mock
		mockContextGatherer = {
			gather: vi.fn().mockResolvedValue({
				context: 'Gathered context',
				tokenBreakdown: { total: 500 }
			}),
			countTokens: vi.fn(() => 100)
		};
		ContextGatherer.mockImplementation(function () {
			return mockContextGatherer;
		});

		// Set up FuzzyTaskSearch mock
		mockFuzzySearch = {
			findRelevantTasks: vi.fn(() => [
				{ id: 1, title: 'Task 1', description: 'Description 1' }
			]),
			getTaskIds: vi.fn(() => ['1'])
		};
		FuzzyTaskSearch.mockImplementation(function () {
			return mockFuzzySearch;
		});

		// Store references for easier access
		mockReadJSON = utils.readJSON;
		mockFlattenTasks = utils.flattenTasksWithSubtasks;
	});

	describe('tag parameter passing to ContextGatherer', () => {
		it('passes tag parameter to ContextGatherer constructor', async () => {
			const testTag = 'feature-branch';

			await performResearch('Test query', { tag: testTag }, {}, 'json', false);

			expect(ContextGatherer).toHaveBeenCalledWith(
				'/test/project/root',
				testTag
			);
		});

		it('passes undefined tag when no tag is provided', async () => {
			await performResearch('Test query', {}, {}, 'json', false);

			expect(ContextGatherer).toHaveBeenCalledWith(
				'/test/project/root',
				undefined
			);
		});

		it('passes empty string tag when empty string is provided', async () => {
			await performResearch('Test query', { tag: '' }, {}, 'json', false);

			expect(ContextGatherer).toHaveBeenCalledWith('/test/project/root', '');
		});

		it('passes null tag when null is provided', async () => {
			await performResearch('Test query', { tag: null }, {}, 'json', false);

			expect(ContextGatherer).toHaveBeenCalledWith('/test/project/root', null);
		});
	});

	describe('tag-aware readJSON calls', () => {
		it('calls readJSON with correct tag parameter for task discovery', async () => {
			const testTag = 'development';

			await performResearch('Test query', { tag: testTag }, {}, 'json', false);

			expect(mockReadJSON).toHaveBeenCalledWith(
				expect.stringContaining('tasks.json'),
				'/test/project/root',
				testTag
			);
		});

		it('calls readJSON with undefined tag when no tag provided', async () => {
			await performResearch('Test query', {}, {}, 'json', false);

			expect(mockReadJSON).toHaveBeenCalledWith(
				expect.stringContaining('tasks.json'),
				'/test/project/root',
				undefined
			);
		});

		it('calls readJSON with provided projectRoot and tag', async () => {
			const customProjectRoot = '/custom/project/root';
			const testTag = 'production';

			await performResearch(
				'Test query',
				{
					projectRoot: customProjectRoot,
					tag: testTag
				},
				{},
				'json',
				false
			);

			expect(mockReadJSON).toHaveBeenCalledWith(
				expect.stringContaining('tasks.json'),
				customProjectRoot,
				testTag
			);
		});
	});

	describe('context gathering behavior for different tags', () => {
		it('calls contextGatherer.gather with correct parameters', async () => {
			const options = {
				taskIds: ['1', '2'],
				filePaths: ['src/file.js'],
				customContext: 'Custom context',
				includeProjectTree: true,
				tag: 'feature-branch'
			};

			await performResearch('Test query', options, {}, 'json', false);

			expect(mockContextGatherer.gather).toHaveBeenCalledWith({
				tasks: expect.arrayContaining(['1', '2']),
				files: ['src/file.js'],
				customContext: 'Custom context',
				includeProjectTree: true,
				format: 'research',
				includeTokenCounts: true
			});
		});

		it('handles empty task discovery gracefully when readJSON fails', async () => {
			mockReadJSON.mockRejectedValueOnce(new Error('File not found'));

			const result = await performResearch(
				'Test query',
				{ tag: 'test-tag' },
				{},
				'json',
				false
			);

			// Should still succeed even if task discovery fails
			expect(result).toBeDefined();
			expect(mockContextGatherer.gather).toHaveBeenCalledWith({
				tasks: [],
				files: [],
				customContext: '',
				includeProjectTree: false,
				format: 'research',
				includeTokenCounts: true
			});
		});

		it('combines provided taskIds with auto-discovered tasks', async () => {
			const providedTaskIds = ['3', '4'];
			const autoDiscoveredIds = ['1', '2'];

			mockFuzzySearch.getTaskIds.mockReturnValue(autoDiscoveredIds);

			await performResearch(
				'Test query',
				{
					taskIds: providedTaskIds,
					tag: 'feature-branch'
				},
				{},
				'json',
				false
			);

			expect(mockContextGatherer.gather).toHaveBeenCalledWith({
				tasks: expect.arrayContaining([
					...providedTaskIds,
					...autoDiscoveredIds
				]),
				files: [],
				customContext: '',
				includeProjectTree: false,
				format: 'research',
				includeTokenCounts: true
			});
		});

		it('removes duplicate tasks when auto-discovered tasks overlap with provided tasks', async () => {
			const providedTaskIds = ['1', '2'];
			const autoDiscoveredIds = ['2', '3']; // '2' is duplicate

			mockFuzzySearch.getTaskIds.mockReturnValue(autoDiscoveredIds);

			await performResearch(
				'Test query',
				{
					taskIds: providedTaskIds,
					tag: 'feature-branch'
				},
				{},
				'json',
				false
			);

			expect(mockContextGatherer.gather).toHaveBeenCalledWith({
				tasks: ['1', '2', '3'], // Should include '3' but not duplicate '2'
				files: [],
				customContext: '',
				includeProjectTree: false,
				format: 'research',
				includeTokenCounts: true
			});
		});
	});

	describe('tag-aware fuzzy search', () => {
		it('initializes FuzzyTaskSearch with flattened tasks from correct tag', async () => {
			const testTag = 'development';
			const mockFlattenedTasks = [
				{ id: 1, title: 'Dev Task 1' },
				{ id: 2, title: 'Dev Task 2' }
			];

			mockFlattenTasks.mockReturnValue(mockFlattenedTasks);

			await performResearch('Test query', { tag: testTag }, {}, 'json', false);

			expect(mockFlattenTasks).toHaveBeenCalledWith(
				expect.arrayContaining([
					expect.objectContaining({ id: 1 }),
					expect.objectContaining({ id: 2 })
				])
			);
			expect(FuzzyTaskSearch).toHaveBeenCalledWith(
				mockFlattenedTasks,
				'research'
			);
		});

		it('calls fuzzy search with correct parameters', async () => {
			const testQuery = 'authentication implementation';

			await performResearch(
				testQuery,
				{ tag: 'feature-branch' },
				{},
				'json',
				false
			);

			expect(mockFuzzySearch.findRelevantTasks).toHaveBeenCalledWith(
				testQuery,
				{
					maxResults: 8,
					includeRecent: true,
					includeCategoryMatches: true
				}
			);
		});

		it('handles empty tasks data gracefully', async () => {
			mockReadJSON.mockResolvedValueOnce({ tasks: [] });

			await performResearch(
				'Test query',
				{ tag: 'empty-tag' },
				{},
				'json',
				false
			);

			// Should not call FuzzyTaskSearch when no tasks exist
			expect(FuzzyTaskSearch).not.toHaveBeenCalled();
			expect(mockContextGatherer.gather).toHaveBeenCalledWith({
				tasks: [],
				files: [],
				customContext: '',
				includeProjectTree: false,
				format: 'research',
				includeTokenCounts: true
			});
		});

		it('handles null tasks data gracefully', async () => {
			mockReadJSON.mockResolvedValueOnce(null);

			await performResearch(
				'Test query',
				{ tag: 'null-tag' },
				{},
				'json',
				false
			);

			// Should not call FuzzyTaskSearch when data is null
			expect(FuzzyTaskSearch).not.toHaveBeenCalled();
		});
	});

	describe('error handling for invalid tags', () => {
		it('continues execution when readJSON throws error for invalid tag', async () => {
			mockReadJSON.mockRejectedValueOnce(new Error('Tag not found'));

			const result = await performResearch(
				'Test query',
				{ tag: 'invalid-tag' },
				{},
				'json',
				false
			);

			// Should still succeed and return a result
			expect(result).toBeDefined();
			expect(mockContextGatherer.gather).toHaveBeenCalled();
		});

		it('logs debug message when task discovery fails', async () => {
			const mockLog = {
				debug: vi.fn(),
				info: vi.fn(),
				warn: vi.fn(),
				error: vi.fn(),
				success: vi.fn()
			};

			mockReadJSON.mockRejectedValueOnce(new Error('File not found'));

			await performResearch(
				'Test query',
				{ tag: 'error-tag' },
				{ mcpLog: mockLog },
				'json',
				false
			);

			expect(mockLog.debug).toHaveBeenCalledWith(
				expect.stringContaining('Could not auto-discover tasks')
			);
		});

		it('handles ContextGatherer constructor errors gracefully', async () => {
			ContextGatherer.mockImplementationOnce(() => {
				throw new Error('Invalid tag provided');
			});

			await expect(
				performResearch('Test query', { tag: 'invalid-tag' }, {}, 'json', false)
			).rejects.toThrow('Invalid tag provided');
		});

		it('handles ContextGatherer.gather errors gracefully', async () => {
			mockContextGatherer.gather.mockRejectedValueOnce(
				new Error('Gather failed')
			);

			await expect(
				performResearch(
					'Test query',
					{ tag: 'gather-error-tag' },
					{},
					'json',
					false
				)
			).rejects.toThrow('Gather failed');
		});
	});

	describe('MCP integration with tags', () => {
		it('uses MCP logger when mcpLog is provided in context', async () => {
			const mockMCPLog = {
				debug: vi.fn(),
				info: vi.fn(),
				warn: vi.fn(),
				error: vi.fn(),
				success: vi.fn()
			};

			mockReadJSON.mockRejectedValueOnce(new Error('Test error'));

			await performResearch(
				'Test query',
				{ tag: 'mcp-tag' },
				{ mcpLog: mockMCPLog },
				'json',
				false
			);

			expect(mockMCPLog.debug).toHaveBeenCalledWith(
				expect.stringContaining('Could not auto-discover tasks')
			);
		});

		it('passes session to generateTextService when provided', async () => {
			const mockSession = { userId: 'test-user', env: {} };

			await performResearch(
				'Test query',
				{ tag: 'session-tag' },
				{ session: mockSession },
				'json',
				false
			);

			expect(generateTextService).toHaveBeenCalledWith(
				expect.objectContaining({
					session: mockSession
				})
			);
		});
	});

	describe('output format handling with tags', () => {
		it('prints one context line and the answer once in text format', async () => {
			const consoleSpy = vi.spyOn(console, 'log').mockImplementation();

			await performResearch(
				'Test query',
				{ taskIds: ['2'], tag: 'ui-tag' },
				{},
				'text',
				false
			);

			const printed = consoleSpy.mock.calls.map((call) => String(call[0]));
			expect(printed.some((line) => line.includes('Context: task 2'))).toBe(
				true
			);
			expect(
				printed.filter((line) => line.includes('Test research result'))
			).toHaveLength(1);
			expect(printed.join('\n')).not.toContain('AI Research Query');

			consoleSpy.mockRestore();
		});

		it('prints nothing in json format', async () => {
			const consoleSpy = vi.spyOn(console, 'log').mockImplementation();

			await performResearch('Test query', { tag: 'ui-tag' }, {}, 'json', false);

			expect(consoleSpy).not.toHaveBeenCalled();

			consoleSpy.mockRestore();
		});
	});

	describe('comprehensive tag integration test', () => {
		it('performs complete research flow with tag-aware functionality', async () => {
			const testOptions = {
				taskIds: ['1', '2'],
				filePaths: ['src/main.js'],
				customContext: 'Testing tag integration',
				includeProjectTree: true,
				detailLevel: 'high',
				tag: 'integration-test',
				projectRoot: '/custom/root'
			};

			const testContext = {
				session: { userId: 'test-user' },
				mcpLog: {
					debug: vi.fn(),
					info: vi.fn(),
					warn: vi.fn(),
					error: vi.fn(),
					success: vi.fn()
				},
				commandName: 'test-research',
				outputType: 'mcp'
			};

			// Mock successful task discovery
			mockFuzzySearch.getTaskIds.mockReturnValue(['3', '4']);

			const result = await performResearch(
				'Integration test query',
				testOptions,
				testContext,
				'json',
				false
			);

			// Verify ContextGatherer was initialized with correct tag
			expect(ContextGatherer).toHaveBeenCalledWith(
				'/custom/root',
				'integration-test'
			);

			// Verify readJSON was called with correct parameters
			expect(mockReadJSON).toHaveBeenCalledWith(
				expect.stringContaining('tasks.json'),
				'/custom/root',
				'integration-test'
			);

			// Verify context gathering was called with combined tasks
			expect(mockContextGatherer.gather).toHaveBeenCalledWith({
				tasks: ['1', '2', '3', '4'],
				files: ['src/main.js'],
				customContext: 'Testing tag integration',
				includeProjectTree: true,
				format: 'research',
				includeTokenCounts: true
			});

			// Verify AI service was called with session
			expect(generateTextService).toHaveBeenCalledWith(
				expect.objectContaining({
					session: testContext.session,
					role: 'research'
				})
			);

			expect(result).toBeDefined();
		});
	});
});

describe('appendResearchToTask', () => {
	const tasks = () => ({
		tasks: [
			{
				id: 3,
				title: 'Sign-in',
				details: 'Use argon2.',
				subtasks: [{ id: 2, title: 'Session store', details: '' }]
			}
		]
	});

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('appends the answer to the task details without an AI call', () => {
		const data = tasks();
		utils.readJSON.mockReturnValue(data);

		const saved = appendResearchToTask(
			'/p/.taskgraph/tasks/tasks.json',
			'3',
			'## Research: sessions\n\nUse connect-pg-simple.',
			{ projectRoot: '/p', tag: 'master' }
		);

		expect(saved).toEqual({ id: '3', title: 'Sign-in' });
		expect(data.tasks[0].details).toMatch(
			/^Use argon2\.\n<info added on .+>\n## Research: sessions\n\nUse connect-pg-simple\.\n<\/info added on .+>$/
		);
		expect(utils.writeJSON).toHaveBeenCalledWith(
			'/p/.taskgraph/tasks/tasks.json',
			data,
			'/p',
			'master'
		);
		expect(generateTextService).not.toHaveBeenCalled();
	});

	it('appends to a subtask', () => {
		const data = tasks();
		utils.readJSON.mockReturnValue(data);

		appendResearchToTask('/p/tasks.json', '3.2', 'Notes', {});

		expect(data.tasks[0].subtasks[0].details).toContain('Notes');
		expect(data.tasks[0].details).toBe('Use argon2.');
	});

	it('refuses missing tasks and subtasks without writing', () => {
		utils.readJSON.mockReturnValue(tasks());

		expect(() => appendResearchToTask('/p/tasks.json', '9', 'x')).toThrow(
			"Task 9 doesn't exist"
		);
		expect(() => appendResearchToTask('/p/tasks.json', '3.7', 'x')).toThrow(
			"Subtask 3.7 doesn't exist"
		);
		expect(() => appendResearchToTask('/p/tasks.json', 'abc', 'x')).toThrow(
			"isn't a task ID"
		);
		expect(utils.writeJSON).not.toHaveBeenCalled();
	});
});
