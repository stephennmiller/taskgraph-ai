import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
	createPathGuardHook,
	getPathViolation,
	isInsideRoot
} from '../../../src/ai-providers/claude-code-path-guard.js';

describe('claude-code path guard', () => {
	let base;
	let root;
	let outside;

	beforeAll(() => {
		base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tg-guard-')));
		root = path.join(base, 'project');
		outside = path.join(base, 'secret.txt');
		fs.mkdirSync(path.join(root, 'src'), { recursive: true });
		fs.writeFileSync(outside, 'x');
		fs.symlinkSync(outside, path.join(root, 'link.txt'));
	});

	afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

	it('allows paths inside the root, relative or absolute', () => {
		expect(isInsideRoot(root, 'src/a.js')).toBe(true);
		expect(isInsideRoot(root, path.join(root, 'src'))).toBe(true);
		expect(isInsideRoot(root, root)).toBe(true);
	});

	it('rejects absolute paths, .. traversal and home paths outside the root', () => {
		expect(isInsideRoot(root, outside)).toBe(false);
		expect(isInsideRoot(root, '../secret.txt')).toBe(false);
		expect(isInsideRoot(root, '~/.ssh/id_rsa')).toBe(false);
		expect(isInsideRoot(root, path.join(base, 'project-evil/x'))).toBe(false);
	});

	it('rejects symlinks that point outside the root', () => {
		expect(isInsideRoot(root, 'link.txt')).toBe(false);
	});

	it('checks Read file_path and Grep/Glob path', () => {
		expect(getPathViolation(root, 'Read', { file_path: outside })).toMatch(
			/outside/
		);
		expect(
			getPathViolation(root, 'Read', { file_path: 'src/a.js' })
		).toBeNull();
		expect(
			getPathViolation(root, 'Grep', { pattern: 'x', path: base })
		).toMatch(/outside/);
		expect(getPathViolation(root, 'Grep', { pattern: '../x' })).toBeNull(); // regex
		expect(getPathViolation(root, 'Glob', { pattern: '**/*.js' })).toBeNull();
	});

	it('rejects glob patterns that leave the root', () => {
		expect(getPathViolation(root, 'Glob', { pattern: '../**/*' })).toMatch(
			/may not leave/
		);
		expect(getPathViolation(root, 'Glob', { pattern: '/etc/*' })).toMatch(
			/may not leave/
		);
		expect(
			getPathViolation(root, 'Grep', { pattern: 'x', glob: '../*' })
		).toMatch(/may not leave/);
	});

	it('ignores tools it does not guard', () => {
		expect(getPathViolation(root, 'WebFetch', { url: 'https://x' })).toBeNull();
	});

	it('hook denies outside access and returns nothing for inside access', async () => {
		const entry = createPathGuardHook(root);
		expect(entry.matcher).toBe('Read|Grep|Glob');
		const [hook] = entry.hooks;

		const denied = await hook({
			tool_name: 'Read',
			tool_input: { file_path: outside }
		});
		expect(denied.hookSpecificOutput.permissionDecision).toBe('deny');
		expect(denied.hookSpecificOutput.hookEventName).toBe('PreToolUse');

		expect(
			await hook({ tool_name: 'Read', tool_input: { file_path: 'src/a.js' } })
		).toEqual({});
	});
});
