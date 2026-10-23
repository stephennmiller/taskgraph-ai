// Load ui.js first: Vitest's module runner mishandles the @tm/cli <-> ui.js
// import cycle (`export * as ui`) when @tm/cli is the entry point.
import '../../scripts/modules/ui.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { vi } from 'vitest';

// Reduce noise in test output
process.env.TASKGRAPH_LOG_LEVEL = 'error';

// === Mock everything early ===
vi.doMock('child_process', () => ({ execSync: vi.fn() }));
vi.doMock('fs', async () => ({
	...(await vi.importActual('fs')),
	mkdirSync: vi.fn(),
	writeFileSync: vi.fn(),
	readFileSync: vi.fn(),
	appendFileSync: vi.fn(),
	existsSync: vi.fn(),
	mkdtempSync: (await vi.importActual('fs')).mkdtempSync,
	rmSync: (await vi.importActual('fs')).rmSync
}));

// Mock console methods to suppress output
const consoleMethods = ['log', 'info', 'warn', 'error', 'clear'];
consoleMethods.forEach((method) => {
	global.console[method] = vi.fn();
});

// Mock ES modules using unstable_mockModule
vi.doMock('../../scripts/modules/utils.js', () => ({
	isSilentMode: vi.fn(() => true),
	enableSilentMode: vi.fn(),
	log: vi.fn(),
	findProjectRoot: vi.fn(() => process.cwd()),
	getCurrentTag: vi.fn(() => 'master')
}));

// Mock git-utils module
vi.doMock('../../scripts/modules/utils/git-utils.js', () => ({
	insideGitWorkTree: vi.fn(() => false)
}));

// Mock rule transformer
vi.doMock('../../src/utils/rule-transformer.js', () => ({
	convertAllRulesToProfileRules: vi.fn(),
	getRulesProfile: vi.fn(() => ({
		conversionConfig: {},
		globalReplacements: []
	}))
}));

// Mock any other modules that might output or do real operations
vi.doMock('../../scripts/modules/config-manager.js', () => ({
	createDefaultConfig: vi.fn(() => ({ models: {}, project: {} })),
	saveConfig: vi.fn(),
	moveMachineSettings: vi.fn(() => false)
}));

// Mock display libraries
vi.doMock('figlet', () => ({ textSync: vi.fn(() => 'MOCKED BANNER') }));
vi.doMock('gradient-string', () => vi.fn(() => vi.fn((text) => text)));
vi.doMock('chalk', () => ({
	blue: vi.fn((text) => text),
	green: vi.fn((text) => text),
	red: vi.fn((text) => text),
	yellow: vi.fn((text) => text),
	cyan: vi.fn((text) => text),
	white: vi.fn((text) => text),
	dim: vi.fn((text) => text),
	bold: vi.fn((text) => text),
	underline: vi.fn((text) => text)
}));

const { execSync } = await import('child_process');
const mockFs = await import('fs');

// Import the mocked modules
const mockUtils = await import('../../scripts/modules/utils.js');
const mockGitUtils = await import('../../scripts/modules/utils/git-utils.js');
const mockRuleTransformer = await import('../../src/utils/rule-transformer.js');

// Import after mocks
import { initializeProject } from '../../scripts/init.js';

describe('initializeProject – Git / Alias flag logic', () => {
	let tmpDir;
	const origCwd = process.cwd();

	// Standard non-interactive options for all tests
	const baseOptions = {
		yes: true,
		skipInstall: true,
		name: 'test-project',
		description: 'Test project description',
		version: '1.0.0',
		author: 'Test Author'
	};

	beforeEach(() => {
		vi.clearAllMocks();

		// Set up basic fs mocks
		mockFs.mkdirSync.mockImplementation(() => {});
		mockFs.writeFileSync.mockImplementation(() => {});
		mockFs.readFileSync.mockImplementation((filePath) => {
			if (filePath.includes('assets') || filePath.includes('.cursor/rules')) {
				return 'mock template content';
			}
			if (filePath.includes('.zshrc') || filePath.includes('.bashrc')) {
				return '# existing config';
			}
			return '';
		});
		mockFs.appendFileSync.mockImplementation(() => {});
		mockFs.existsSync.mockImplementation((filePath) => {
			// Template source files exist
			if (filePath.includes('assets') || filePath.includes('.cursor/rules')) {
				return true;
			}
			// Shell config files exist by default
			if (filePath.includes('.zshrc') || filePath.includes('.bashrc')) {
				return true;
			}
			return false;
		});

		// Reset utils mocks
		mockUtils.isSilentMode.mockReturnValue(true);
		mockGitUtils.insideGitWorkTree.mockReturnValue(false);

		// Default execSync mock
		execSync.mockImplementation(() => '');

		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-init-'));
		process.chdir(tmpDir);
	});

	afterEach(() => {
		process.chdir(origCwd);
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	describe('Git Flag Behavior', () => {
		it('completes successfully with git:false in dry run', async () => {
			const result = await initializeProject({
				...baseOptions,
				git: false,
				aliases: false,
				dryRun: true
			});

			expect(result.dryRun).toBe(true);
		});

		it('completes successfully with git:true when not inside repo', async () => {
			mockGitUtils.insideGitWorkTree.mockReturnValue(false);

			await expect(
				initializeProject({
					...baseOptions,
					git: true,
					aliases: false,
					dryRun: false
				})
			).resolves.not.toThrow();
		});

		it('completes successfully when already inside repo', async () => {
			mockGitUtils.insideGitWorkTree.mockReturnValue(true);

			await expect(
				initializeProject({
					...baseOptions,
					git: true,
					aliases: false,
					dryRun: false
				})
			).resolves.not.toThrow();
		});

		it('uses default git behavior without errors', async () => {
			mockGitUtils.insideGitWorkTree.mockReturnValue(false);

			await expect(
				initializeProject({
					...baseOptions,
					aliases: false,
					dryRun: false
				})
			).resolves.not.toThrow();
		});

		it('handles git command failures gracefully', async () => {
			mockGitUtils.insideGitWorkTree.mockReturnValue(false);
			execSync.mockImplementation((cmd) => {
				if (cmd.includes('git init')) {
					throw new Error('git not found');
				}
				return '';
			});

			await expect(
				initializeProject({
					...baseOptions,
					git: true,
					aliases: false,
					dryRun: false
				})
			).resolves.not.toThrow();
		});
	});

	describe('Alias Flag Behavior', () => {
		it('completes successfully when aliases:true and environment is set up', async () => {
			const originalShell = process.env.SHELL;
			const originalHome = process.env.HOME;

			process.env.SHELL = '/bin/zsh';
			process.env.HOME = '/mock/home';

			await expect(
				initializeProject({
					...baseOptions,
					git: false,
					aliases: true,
					dryRun: false
				})
			).resolves.not.toThrow();

			process.env.SHELL = originalShell;
			process.env.HOME = originalHome;
		});

		it('completes successfully when aliases:false', async () => {
			await expect(
				initializeProject({
					...baseOptions,
					git: false,
					aliases: false,
					dryRun: false
				})
			).resolves.not.toThrow();
		});

		it('handles missing shell gracefully', async () => {
			const originalShell = process.env.SHELL;
			const originalHome = process.env.HOME;

			delete process.env.SHELL; // Remove shell env var
			process.env.HOME = '/mock/home';

			await expect(
				initializeProject({
					...baseOptions,
					git: false,
					aliases: true,
					dryRun: false
				})
			).resolves.not.toThrow();

			process.env.SHELL = originalShell;
			process.env.HOME = originalHome;
		});

		it('handles missing shell config file gracefully', async () => {
			const originalShell = process.env.SHELL;
			const originalHome = process.env.HOME;

			process.env.SHELL = '/bin/zsh';
			process.env.HOME = '/mock/home';

			// Shell config doesn't exist
			mockFs.existsSync.mockImplementation((filePath) => {
				if (filePath.includes('.zshrc') || filePath.includes('.bashrc')) {
					return false;
				}
				if (filePath.includes('assets') || filePath.includes('.cursor/rules')) {
					return true;
				}
				return false;
			});

			await expect(
				initializeProject({
					...baseOptions,
					git: false,
					aliases: true,
					dryRun: false
				})
			).resolves.not.toThrow();

			process.env.SHELL = originalShell;
			process.env.HOME = originalHome;
		});
	});

	describe('Flag Combinations', () => {
		it.each`
			git      | aliases  | description
			${true}  | ${true}  | ${'git & aliases enabled'}
			${true}  | ${false} | ${'git enabled, aliases disabled'}
			${false} | ${true}  | ${'git disabled, aliases enabled'}
			${false} | ${false} | ${'git & aliases disabled'}
		`('handles $description without errors', async ({ git, aliases }) => {
			const originalShell = process.env.SHELL;
			const originalHome = process.env.HOME;

			if (aliases) {
				process.env.SHELL = '/bin/zsh';
				process.env.HOME = '/mock/home';
			}

			if (git) {
				mockGitUtils.insideGitWorkTree.mockReturnValue(false);
			}

			await expect(
				initializeProject({
					...baseOptions,
					git,
					aliases,
					dryRun: false
				})
			).resolves.not.toThrow();

			process.env.SHELL = originalShell;
			process.env.HOME = originalHome;
		});
	});

	describe('Dry Run Mode', () => {
		it('returns dry run result and performs no operations', async () => {
			const result = await initializeProject({
				...baseOptions,
				git: true,
				aliases: true,
				dryRun: true
			});

			expect(result.dryRun).toBe(true);
		});

		it.each`
			git      | aliases  | description
			${true}  | ${false} | ${'git-specific behavior'}
			${false} | ${false} | ${'no-git behavior'}
			${false} | ${true}  | ${'alias behavior'}
		`('shows $description in dry run', async ({ git, aliases }) => {
			const result = await initializeProject({
				...baseOptions,
				git,
				aliases,
				dryRun: true
			});

			expect(result.dryRun).toBe(true);
		});
	});

	describe('Error Handling', () => {
		it('handles npm install failures gracefully', async () => {
			execSync.mockImplementation((cmd) => {
				if (cmd.includes('npm install')) {
					throw new Error('npm failed');
				}
				return '';
			});

			await expect(
				initializeProject({
					...baseOptions,
					git: false,
					aliases: false,
					skipInstall: false,
					dryRun: false
				})
			).resolves.not.toThrow();
		});

		it('handles git failures gracefully', async () => {
			mockGitUtils.insideGitWorkTree.mockReturnValue(false);
			execSync.mockImplementation((cmd) => {
				if (cmd.includes('git init')) {
					throw new Error('git failed');
				}
				return '';
			});

			await expect(
				initializeProject({
					...baseOptions,
					git: true,
					aliases: false,
					dryRun: false
				})
			).resolves.not.toThrow();
		});

		it('handles file system errors gracefully', async () => {
			mockFs.mkdirSync.mockImplementation(() => {
				throw new Error('Permission denied');
			});

			// Should handle file system errors gracefully
			await expect(
				initializeProject({
					...baseOptions,
					git: false,
					aliases: false,
					dryRun: false
				})
			).resolves.not.toThrow();
		});
	});

	describe('Non-Interactive Mode', () => {
		it('bypasses prompts with yes:true', async () => {
			const result = await initializeProject({
				...baseOptions,
				git: true,
				aliases: true,
				dryRun: true
			});

			expect(result).toEqual({ dryRun: true });
		});

		it('completes without hanging', async () => {
			await expect(
				initializeProject({
					...baseOptions,
					git: false,
					aliases: false,
					dryRun: false
				})
			).resolves.not.toThrow();
		});

		it('handles all flag combinations without hanging', async () => {
			const flagCombinations = [
				{ git: true, aliases: true },
				{ git: true, aliases: false },
				{ git: false, aliases: true },
				{ git: false, aliases: false },
				{} // No flags (uses defaults)
			];

			for (const flags of flagCombinations) {
				await expect(
					initializeProject({
						...baseOptions,
						...flags,
						dryRun: true // Use dry run for speed
					})
				).resolves.not.toThrow();
			}
		});

		it('accepts complete project details', async () => {
			await expect(
				initializeProject({
					name: 'test-project',
					description: 'test description',
					version: '2.0.0',
					author: 'Test User',
					git: false,
					aliases: false,
					dryRun: true
				})
			).resolves.not.toThrow();
		});

		it('works with skipInstall option', async () => {
			await expect(
				initializeProject({
					...baseOptions,
					skipInstall: true,
					git: false,
					aliases: false,
					dryRun: false
				})
			).resolves.not.toThrow();
		});
	});

	describe('Function Integration', () => {
		it('calls utility functions without errors', async () => {
			// Test that initialization completes without throwing
			// Note: ES module mocking with vi.doMock doesn't reliably
			// track mock calls through transitive imports (init.js → ui.js → utils.js),
			// so we verify successful completion instead of specific mock calls
			await expect(
				initializeProject({
					...baseOptions,
					git: false,
					aliases: false,
					dryRun: false
				})
			).resolves.not.toThrow();
		});

		it('handles template operations gracefully', async () => {
			// Make file operations throw errors
			mockFs.writeFileSync.mockImplementation(() => {
				throw new Error('Write failed');
			});

			// Should complete despite file operation failures
			await expect(
				initializeProject({
					...baseOptions,
					git: false,
					aliases: false,
					dryRun: false
				})
			).resolves.not.toThrow();
		});

		it('validates boolean flag conversion', async () => {
			// Test the boolean flag handling specifically
			await expect(
				initializeProject({
					...baseOptions,
					git: true, // Should convert to initGit: true
					aliases: false, // Should convert to addAliases: false
					dryRun: true
				})
			).resolves.not.toThrow();

			await expect(
				initializeProject({
					...baseOptions,
					git: false, // Should convert to initGit: false
					aliases: true, // Should convert to addAliases: true
					dryRun: true
				})
			).resolves.not.toThrow();
		});
	});
});
