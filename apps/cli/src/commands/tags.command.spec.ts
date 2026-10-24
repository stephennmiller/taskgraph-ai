/**
 * @fileoverview Unit tests for the tags command: add (with --from-branch),
 * remove's confirmation, and the deprecated aliases
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

import {
	ERROR_CODES,
	TaskGraphError,
	createTmCore,
	getProjectPaths
} from '@tm/core';
import { displayError } from '../utils/index.js';
import { TagsCommand } from './tags.command.js';

const defaultDescription = 'Tag created from git branch "feature/login"';

/** tm-core's createTagFromBranch: on feature/login it calls back to write the tag */
const createTagFromBranch = vi.fn();
const createTag = vi.fn();

function runAdd(...args: string[]): Promise<unknown> {
	const tags = new TagsCommand().setThrowOnError(true);
	new Command().exitOverride().addCommand(tags);
	return tags.parseAsync(['add', ...args], { from: 'user' });
}

describe('tags add', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(createTmCore).mockResolvedValue({
			tasks: { createTagFromBranch, createTag }
		} as any);
		vi.mocked(getProjectPaths).mockReturnValue({
			projectRoot: '/test/project'
		} as any);
		createTag.mockImplementation(async (tagName) => ({
			tagName,
			created: true,
			tasksCopied: 0,
			sourceTag: null,
			description: 'Tag created on today'
		}));
		vi.spyOn(console, 'log').mockImplementation(() => {});
		createTagFromBranch.mockImplementation(async (createTag) => ({
			branchName: 'feature/login',
			tagName: 'feature-login',
			created: await createTag('feature-login', { defaultDescription }),
			mappingUpdated: true
		}));
	});

	it('creates a tag with the given name', async () => {
		await runAdd('sprint-2');

		expect(createTag).toHaveBeenCalledWith('sprint-2', {
			description: undefined,
			copyFromTag: undefined,
			copyFromCurrent: undefined
		});
		expect(createTagFromBranch).not.toHaveBeenCalled();
	});

	it('creates a tag from the current branch when given only --from-branch', async () => {
		await runAdd('--from-branch');

		expect(createTagFromBranch).toHaveBeenCalledTimes(1);
		expect(createTag).toHaveBeenCalledWith('feature-login', {
			description: undefined,
			copyFromTag: undefined,
			copyFromCurrent: undefined,
			defaultDescription
		});
	});

	it('passes --description and --copy-from through to the branch tag', async () => {
		await runAdd(
			'--from-branch',
			'--description',
			'Login work',
			'--copy-from',
			'master'
		);

		expect(createTag).toHaveBeenCalledWith('feature-login', {
			description: 'Login work',
			copyFromTag: 'master',
			copyFromCurrent: undefined,
			defaultDescription
		});
	});

	it('rejects a name together with --from-branch before touching anything', async () => {
		await expect(runAdd('sprint-2', '--from-branch')).rejects.toThrow(
			/not both/i
		);

		expect(createTmCore).not.toHaveBeenCalled();
		expect(createTag).not.toHaveBeenCalled();
	});

	it('rejects neither a name nor --from-branch', async () => {
		await expect(runAdd()).rejects.toThrow(/needs a tag name/i);

		expect(createTmCore).not.toHaveBeenCalled();
		expect(createTag).not.toHaveBeenCalled();
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
		expect(createTag).not.toHaveBeenCalled();
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

describe('tags remove', () => {
	const deleteTag = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(createTmCore).mockResolvedValue({ tasks: { deleteTag } } as any);
		vi.mocked(getProjectPaths).mockReturnValue({
			projectRoot: '/test/project'
		} as any);
		// tm-core asks before deleting a tag with tasks
		deleteTag.mockImplementation(async (tagName, options) =>
			options?.confirm && !(await options.confirm(2))
				? { tagName, deleted: false, cancelled: true }
				: {
						tagName,
						deleted: true,
						tasksDeleted: 2,
						wasCurrentTag: false,
						switchedToMaster: false
					}
		);
		vi.spyOn(console, 'log').mockImplementation(() => {});
	});

	function runRemove(...args: string[]) {
		const tags = new TagsCommand().setThrowOnError(true);
		new Command().exitOverride().addCommand(tags);
		return tags.parseAsync(['remove', ...args], { from: 'user' });
	}

	it('deletes without asking with --yes', async () => {
		await runRemove('old', '--yes');

		expect(deleteTag).toHaveBeenCalledWith('old', { confirm: undefined });
	});

	it('without a terminal, refuses with a hint instead of asking', async () => {
		const isTTY = process.stdin.isTTY;
		process.stdin.isTTY = false;
		try {
			await expect(runRemove('old')).rejects.toThrow(
				'Deleting tag old and its 2 tasks needs confirmation'
			);
		} finally {
			process.stdin.isTTY = isTTY;
		}
		expect(displayError).toHaveBeenCalledWith(
			expect.objectContaining({
				hint: 'Pass `--yes` to delete it without asking'
			})
		);
	});
});

describe('the deprecated tag commands', () => {
	const useTag = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(createTmCore).mockResolvedValue({ tasks: { useTag } } as any);
		vi.mocked(getProjectPaths).mockReturnValue({
			projectRoot: '/test/project'
		} as any);
		useTag.mockResolvedValue({
			previousTag: 'master',
			currentTag: 'feature',
			switched: true,
			taskCount: 0,
			nextTask: null
		});
		vi.spyOn(console, 'log').mockImplementation(() => {});
	});

	it('warn, then run their tags replacement', async () => {
		const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
		const program = new Command().exitOverride();
		TagsCommand.register(program);

		await program.parseAsync(['use-tag', 'feature'], { from: 'user' });

		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining('use-tag is deprecated')
		);
		expect(useTag).toHaveBeenCalledWith('feature');
	});

	it('accept --file naming the project tasks file', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.mocked(getProjectPaths).mockReturnValue({
			projectRoot: '/test/project',
			tasksPath: '/test/project/.taskgraph/tasks/tasks.json'
		});
		const program = new Command().exitOverride();
		TagsCommand.register(program).setThrowOnError(true);

		await program.parseAsync(
			['use-tag', 'feature', '-f', '.taskgraph/tasks/tasks.json'],
			{ from: 'user' }
		);

		expect(useTag).toHaveBeenCalledWith('feature');
	});

	it('refuse --file naming another file without touching the project', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.mocked(getProjectPaths).mockReturnValue({
			projectRoot: '/test/project',
			tasksPath: '/test/project/.taskgraph/tasks/tasks.json'
		});
		const program = new Command().exitOverride();
		TagsCommand.register(program).setThrowOnError(true);

		await expect(
			program.parseAsync(['use-tag', 'feature', '--file', 'other.json'], {
				from: 'user'
			})
		).rejects.toThrow('--file is no longer supported');
		expect(useTag).not.toHaveBeenCalled();
	});
});
