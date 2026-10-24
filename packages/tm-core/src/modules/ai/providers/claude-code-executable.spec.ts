import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClaudeCode as mockedCreateClaudeCode } from 'ai-sdk-provider-claude-code';
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	vi
} from 'vitest';
import {
	ClaudeCodeProvider,
	claudeFromPath,
	hasBundledClaudeBinary,
	isTrustedClaudeExecutable
} from './claude-code.js';

// Mock the ai-sdk-provider-claude-code package
vi.mock('ai-sdk-provider-claude-code', () => ({
	createClaudeCode: vi.fn(() => {
		const provider: any = (modelId: string, settings: unknown) => ({
			// Minimal mock language model surface
			id: modelId,
			settings,
			doGenerate: vi.fn(() => ({ text: 'ok', usage: {} })),
			doStream: vi.fn(() => ({ stream: true }))
		});
		provider.languageModel = vi.fn((id, settings) => ({ id, settings }));
		provider.chat = provider.languageModel;
		return provider;
	})
}));

const createClaudeCode = mockedCreateClaudeCode as any;

describe('isTrustedClaudeExecutable', () => {
	let base: string;
	let project: string;
	let outsideClaude: string;

	beforeAll(() => {
		base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tg-exe-')));
		project = path.join(base, 'project');
		fs.mkdirSync(path.join(project, 'bin'), { recursive: true });
		fs.mkdirSync(path.join(base, 'bin'));
		outsideClaude = path.join(base, 'bin', 'claude');
		fs.writeFileSync(outsideClaude, '');
		fs.writeFileSync(path.join(project, 'bin', 'claude'), '');
		fs.writeFileSync(path.join(base, 'bin', 'sh'), '');
		// A link outside the project named claude that points into it
		fs.symlinkSync(
			path.join(project, 'bin', 'claude'),
			path.join(base, 'claude')
		);
	});

	afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

	it('allows an absolute claude binary outside the project', () => {
		expect(isTrustedClaudeExecutable(outsideClaude, project)).toBe(true);
	});

	it('refuses relative paths, other names and missing files', () => {
		expect(isTrustedClaudeExecutable('bin/claude', project)).toBe(false);
		expect(
			isTrustedClaudeExecutable(path.join(base, 'bin', 'sh'), project)
		).toBe(false);
		expect(
			isTrustedClaudeExecutable(path.join(base, 'nope', 'claude'), project)
		).toBe(false);
	});

	it('refuses a claude inside the project, directly or through a link', () => {
		expect(
			isTrustedClaudeExecutable(path.join(project, 'bin', 'claude'), project)
		).toBe(false);
		expect(isTrustedClaudeExecutable(path.join(base, 'claude'), project)).toBe(
			false
		);
	});

	describe('claude on PATH', () => {
		const originalPath = process.env.PATH;
		const usePath = (dir: string) => {
			process.env.PATH = dir;
		};

		beforeAll(() => {
			fs.chmodSync(outsideClaude, 0o755);
			fs.chmodSync(path.join(project, 'bin', 'claude'), 0o755);
		});
		afterEach(() => {
			process.env.PATH = originalPath;
		});

		it('uses the claude on PATH when the SDK binary is missing', () => {
			usePath(path.join(base, 'bin'));
			expect(claudeFromPath(project, false)).toBe(outsideClaude);
		});

		it('does not use a claude inside the project', () => {
			usePath(path.join(project, 'bin'));
			expect(claudeFromPath(project, false)).toBeUndefined();
		});

		it('does not use a relative PATH entry or a link into the project', () => {
			usePath(path.relative(process.cwd(), path.join(base, 'bin')));
			expect(claudeFromPath(project, false)).toBeUndefined();
			usePath(base);
			expect(claudeFromPath(project, false)).toBeUndefined();
		});

		it('leaves the SDK binary in charge when it is installed', async () => {
			usePath(path.join(base, 'bin'));
			expect(hasBundledClaudeBinary()).toBe(true);
			expect(claudeFromPath(project)).toBeUndefined();

			await new ClaudeCodeProvider({
				log: vi.fn(),
				getSettingsForCommand: () => ({}),
				supportedModels: ['opus', 'sonnet', 'haiku']
			}).getClient({
				role: 'main',
				projectRoot: project
			});
			const settings = createClaudeCode.mock.calls.at(-1)[0].defaultSettings;
			expect(settings).not.toHaveProperty('pathToClaudeCodeExecutable');
		});
	});
});
