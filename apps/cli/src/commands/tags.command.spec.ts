/**
 * @fileoverview Unit tests for `tags add`, focused on --from-branch
 */

import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tm/core', () => ({
	createTmCore: vi.fn(),
	getProjectPaths: vi.fn(),
	getCurrentBranch: vi.fn(),
	isGitRepository: vi.fn()
}));

vi.mock('../utils/index.js', () => ({
	displayError: vi.fn()
}));

vi.mock('../../../../scripts/modules/task-manager/tag-management.js', () => ({
	copyTag: vi.fn(),
	createTag: vi.fn(),
	createTagFromBranch: vi.fn(),
	deleteTag: vi.fn(),
	tags: vi.fn(),
	renameTag: vi.fn(),
	useTag: vi.fn()
}));

import {
	createTmCore,
	getCurrentBranch,
	getProjectPaths,
	isGitRepository
} from '@tm/core';
import * as tagManagement from '../../../../scripts/modules/task-manager/tag-management.js';
import { TagsCommand } from './tags.command.js';

const tasksPath = '/test/project/.taskgraph/tasks/tasks.json';
const context = { projectRoot: '/test/project' };

function runAdd(...args: string[]): Promise<unknown> {
	const tags = new TagsCommand().setThrowOnError(true);
	new Command().exitOverride().addCommand(tags);
	return tags.parseAsync(['add', ...args], { from: 'user' });
}

describe('tags add', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(createTmCore).mockResolvedValue({} as any);
		vi.mocked(getProjectPaths).mockReturnValue({
			projectRoot: '/test/project',
			tasksPath
		} as any);
		vi.mocked(isGitRepository).mockResolvedValue(true);
		vi.mocked(getCurrentBranch).mockResolvedValue('feature/login');
		vi.mocked(tagManagement.createTagFromBranch).mockResolvedValue({
			tagName: 'feature-login'
		});
	});

	it('creates a tag with the given name', async () => {
		await runAdd('sprint-2');

		expect(tagManagement.createTag).toHaveBeenCalledWith(
			tasksPath,
			'sprint-2',
			{ description: undefined, copyFromTag: undefined },
			context,
			'text'
		);
		expect(tagManagement.createTagFromBranch).not.toHaveBeenCalled();
	});

	it('creates a tag from the current branch when given only --from-branch', async () => {
		await runAdd('--from-branch');

		expect(tagManagement.createTagFromBranch).toHaveBeenCalledWith(
			tasksPath,
			'feature/login',
			{ description: undefined, copyFromTag: undefined },
			context,
			'text'
		);
		expect(tagManagement.createTag).not.toHaveBeenCalled();
	});

	it('passes --description and --copy-from through to the branch tag', async () => {
		await runAdd(
			'--from-branch',
			'--description',
			'Login work',
			'--copy-from',
			'master'
		);

		expect(tagManagement.createTagFromBranch).toHaveBeenCalledWith(
			tasksPath,
			'feature/login',
			{ description: 'Login work', copyFromTag: 'master' },
			context,
			'text'
		);
	});

	it('rejects a name together with --from-branch before touching anything', async () => {
		await expect(runAdd('sprint-2', '--from-branch')).rejects.toThrow(
			/not both/i
		);

		expect(createTmCore).not.toHaveBeenCalled();
		expect(tagManagement.createTag).not.toHaveBeenCalled();
		expect(tagManagement.createTagFromBranch).not.toHaveBeenCalled();
	});

	it('rejects neither a name nor --from-branch', async () => {
		await expect(runAdd()).rejects.toThrow(/needs a tag name/i);

		expect(createTmCore).not.toHaveBeenCalled();
		expect(tagManagement.createTag).not.toHaveBeenCalled();
		expect(tagManagement.createTagFromBranch).not.toHaveBeenCalled();
	});

	it('rejects --from-branch outside a git repository', async () => {
		vi.mocked(isGitRepository).mockResolvedValue(false);

		await expect(runAdd('--from-branch')).rejects.toThrow(/git repository/i);

		expect(tagManagement.createTagFromBranch).not.toHaveBeenCalled();
	});

	it.each([
		['a detached HEAD', 'HEAD'],
		['no branch', null]
	])('rejects --from-branch on %s', async (_label, branch) => {
		vi.mocked(getCurrentBranch).mockResolvedValue(branch);

		await expect(runAdd('--from-branch')).rejects.toThrow(
			/which git branch is checked out/i
		);

		expect(tagManagement.createTagFromBranch).not.toHaveBeenCalled();
	});
});
