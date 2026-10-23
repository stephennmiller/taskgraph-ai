/**
 * @fileoverview Unit tests for `tags add`, focused on --from-branch
 */

import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tm/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tm/core')>()),
	createTmCore: vi.fn(),
	getProjectPaths: vi.fn()
}));

vi.mock('../utils/index.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('../utils/index.js')>()),
	displayError: vi.fn()
}));

vi.mock('../../../../scripts/modules/task-manager/tag-management.js', () => ({
	copyTag: vi.fn(),
	createTag: vi.fn(),
	deleteTag: vi.fn(),
	tags: vi.fn(),
	renameTag: vi.fn(),
	useTag: vi.fn()
}));

import {
	ERROR_CODES,
	TaskGraphError,
	createTmCore,
	getProjectPaths
} from '@tm/core';
import * as tagManagement from '../../../../scripts/modules/task-manager/tag-management.js';
import { displayError } from '../utils/index.js';
import { TagsCommand } from './tags.command.js';

const tasksPath = '/test/project/.taskgraph/tasks/tasks.json';
const context = { projectRoot: '/test/project' };
const defaultDescription = 'Tag created from git branch "feature/login"';

/** tm-core's createTagFromBranch: on feature/login it calls back to write the tag */
const createTagFromBranch = vi.fn();

function runAdd(...args: string[]): Promise<unknown> {
	const tags = new TagsCommand().setThrowOnError(true);
	new Command().exitOverride().addCommand(tags);
	return tags.parseAsync(['add', ...args], { from: 'user' });
}

describe('tags add', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(createTmCore).mockResolvedValue({
			tasks: { createTagFromBranch }
		} as any);
		vi.mocked(getProjectPaths).mockReturnValue({
			projectRoot: '/test/project',
			tasksPath
		} as any);
		createTagFromBranch.mockImplementation(async (createTag) => ({
			branchName: 'feature/login',
			tagName: 'feature-login',
			created: await createTag('feature-login', { defaultDescription }),
			mappingUpdated: true
		}));
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
		expect(createTagFromBranch).not.toHaveBeenCalled();
	});

	it('creates a tag from the current branch when given only --from-branch', async () => {
		await runAdd('--from-branch');

		expect(createTagFromBranch).toHaveBeenCalledTimes(1);
		expect(tagManagement.createTag).toHaveBeenCalledWith(
			tasksPath,
			'feature-login',
			{ description: undefined, copyFromTag: undefined, defaultDescription },
			context,
			'text'
		);
	});

	it('passes --description and --copy-from through to the branch tag', async () => {
		await runAdd(
			'--from-branch',
			'--description',
			'Login work',
			'--copy-from',
			'master'
		);

		expect(tagManagement.createTag).toHaveBeenCalledWith(
			tasksPath,
			'feature-login',
			{ description: 'Login work', copyFromTag: 'master', defaultDescription },
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
	});

	it('rejects neither a name nor --from-branch', async () => {
		await expect(runAdd()).rejects.toThrow(/needs a tag name/i);

		expect(createTmCore).not.toHaveBeenCalled();
		expect(tagManagement.createTag).not.toHaveBeenCalled();
	});

	it.each([
		[
			ERROR_CODES.NOT_GIT_REPO,
			"--from-branch needs a git repository, and this isn't one"
		],
		[
			ERROR_CODES.NO_CURRENT_BRANCH,
			"Couldn't tell which git branch is checked out"
		]
	])('words the %s failure for the CLI, with a hint', async (code, message) => {
		createTagFromBranch.mockRejectedValue(new TaskGraphError('git', code));

		await expect(runAdd('--from-branch')).rejects.toThrow(message);

		expect(displayError).toHaveBeenCalledWith(
			expect.objectContaining({
				message,
				hint: 'Name the tag instead: `taskgraph tags add <name>`'
			})
		);
		expect(tagManagement.createTag).not.toHaveBeenCalled();
	});

	it('shows any other failure as it is', async () => {
		createTagFromBranch.mockRejectedValue(
			new TaskGraphError(
				'Branch "main" cannot be converted to a valid tag name',
				ERROR_CODES.INVALID_BRANCH_FOR_TAG
			)
		);

		await expect(runAdd('--from-branch')).rejects.toThrow(
			'Branch "main" cannot be converted to a valid tag name'
		);
	});
});
