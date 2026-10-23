/**
 * @fileoverview Creating a tag from the current git branch, in real git
 * repositories: the git checks, the call that writes the tag, and the
 * branch-to-tag mapping in state.json.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '../../../src/common/errors/taskgraph-error.js';
import {
	createTagFromBranch,
	recordBranchTag
} from '../../../src/modules/tasks/utils/branch-tag.js';

const git = (cwd: string, ...args: string[]) =>
	execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();

/** A repository with one commit, on `branch` */
function initRepo(dir: string, branch: string): void {
	git(dir, 'init', '-q', '-b', 'main');
	git(
		dir,
		'-c',
		'user.name=x',
		'-c',
		'user.email=x@example.com',
		'commit',
		'-q',
		'--allow-empty',
		'-m',
		'init'
	);
	if (branch !== 'main') git(dir, 'checkout', '-q', '-b', branch);
}

describe('createTagFromBranch', () => {
	let dir: string;
	const statePath = () => path.join(dir, '.taskgraph', 'state.json');
	const readState = () => JSON.parse(fs.readFileSync(statePath(), 'utf8'));

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-branch-tag-'));
		fs.mkdirSync(path.join(dir, '.taskgraph'));
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it('creates the tag for the current branch and maps the branch to it', async () => {
		initRepo(dir, 'feature/login');
		fs.writeFileSync(
			statePath(),
			JSON.stringify({
				currentTag: 'master',
				migrationNoticeShown: true,
				branchTagMapping: { 'feature/old': 'feature-old' }
			})
		);
		const createTag = vi.fn().mockResolvedValue({ created: true });

		const result = await createTagFromBranch(dir, createTag);

		expect(createTag).toHaveBeenCalledWith('feature-login', {
			defaultDescription: 'Tag created from git branch "feature/login"'
		});
		expect(result).toEqual({
			branchName: 'feature/login',
			tagName: 'feature-login',
			created: { created: true },
			mappingUpdated: true
		});
		expect(readState()).toEqual({
			currentTag: 'master',
			migrationNoticeShown: true,
			branchTagMapping: {
				'feature/old': 'feature-old',
				'feature/login': 'feature-login'
			}
		});
	});

	it('fails with NOT_GIT_REPO outside a git repository and writes nothing', async () => {
		const createTag = vi.fn();

		await expect(createTagFromBranch(dir, createTag)).rejects.toMatchObject({
			code: ERROR_CODES.NOT_GIT_REPO
		});
		expect(createTag).not.toHaveBeenCalled();
		expect(fs.existsSync(statePath())).toBe(false);
	});

	it('fails with NO_CURRENT_BRANCH on a detached HEAD', async () => {
		initRepo(dir, 'main');
		git(dir, 'checkout', '-q', '--detach');
		const createTag = vi.fn();

		await expect(createTagFromBranch(dir, createTag)).rejects.toMatchObject({
			code: ERROR_CODES.NO_CURRENT_BRANCH
		});
		expect(createTag).not.toHaveBeenCalled();
	});

	it('fails with INVALID_BRANCH_FOR_TAG on main', async () => {
		initRepo(dir, 'main');
		const createTag = vi.fn();

		await expect(createTagFromBranch(dir, createTag)).rejects.toMatchObject({
			code: ERROR_CODES.INVALID_BRANCH_FOR_TAG,
			message: 'Branch "main" cannot be converted to a valid tag name'
		});
		expect(createTag).not.toHaveBeenCalled();
	});

	it('leaves state.json alone when the tag cannot be created', async () => {
		initRepo(dir, 'topic');
		fs.writeFileSync(statePath(), JSON.stringify({ currentTag: 'master' }));
		const createTag = vi
			.fn()
			.mockRejectedValue(new Error('Tag "topic" already exists'));

		await expect(createTagFromBranch(dir, createTag)).rejects.toThrow(
			'Tag "topic" already exists'
		);
		expect(readState()).toEqual({ currentTag: 'master' });
	});

	it('keeps the tag and reports mappingUpdated false when state.json is unreadable', async () => {
		initRepo(dir, 'topic');
		fs.writeFileSync(statePath(), '{ not json');
		const createTag = vi.fn().mockResolvedValue('made');

		const result = await createTagFromBranch(dir, createTag);

		expect(result).toMatchObject({ tagName: 'topic', mappingUpdated: false });
		expect(fs.readFileSync(statePath(), 'utf8')).toBe('{ not json');
	});
});

describe('recordBranchTag', () => {
	let dir: string;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-branch-tag-'));
		fs.mkdirSync(path.join(dir, '.taskgraph'));
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it('creates state.json with the mapping when there is none', async () => {
		await recordBranchTag(dir, 'topic', 'topic');

		expect(
			fs.readFileSync(path.join(dir, '.taskgraph', 'state.json'), 'utf8')
		).toBe(JSON.stringify({ branchTagMapping: { topic: 'topic' } }, null, 2));
	});

	it('replaces a branchTagMapping that is an array, which would drop the entry', async () => {
		const statePath = path.join(dir, '.taskgraph', 'state.json');
		fs.writeFileSync(statePath, JSON.stringify({ branchTagMapping: [] }));

		await recordBranchTag(dir, 'topic', 'topic');

		expect(JSON.parse(fs.readFileSync(statePath, 'utf8'))).toEqual({
			branchTagMapping: { topic: 'topic' }
		});
	});

	it('refuses a state.json that is not a JSON object and leaves it alone', async () => {
		const statePath = path.join(dir, '.taskgraph', 'state.json');
		fs.writeFileSync(statePath, '[]');

		await expect(recordBranchTag(dir, 'topic', 'topic')).rejects.toThrow(
			'state.json does not hold a JSON object'
		);
		expect(fs.readFileSync(statePath, 'utf8')).toBe('[]');
	});
});
