/**
 * @fileoverview `list --mine`: only the tasks assigned to the GitHub login
 * gh is signed in as
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tm/core', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@tm/core')>();
	return { ...actual, createTmCore: vi.fn() };
});

vi.mock('../utils/error-handler.js', () => ({ displayError: vi.fn() }));
vi.mock('../utils/display-helpers.js', () => ({
	displayCommandHeader: vi.fn()
}));

import { ListTasksCommand } from './list.command.js';

describe('list --mine', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('lists only the tasks assigned to the signed-in GitHub user', async () => {
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		const command = new ListTasksCommand();
		(command as any).tmCore = {
			tasks: {
				getArchivedIds: vi.fn().mockResolvedValue(new Set()),
				list: vi.fn().mockResolvedValue({
					tasks: [
						{ id: '1', title: 'Mine', status: 'pending', assignee: 'octocat' },
						{ id: '2', title: 'Theirs', status: 'pending', assignee: 'hubot' },
						{ id: '3', title: 'Nobody', status: 'pending' }
					],
					total: 3,
					filtered: 3
				}),
				getNext: vi.fn().mockResolvedValue(null)
			},
			config: { getActiveTag: vi.fn().mockReturnValue('master') },
			github: { requireLogin: vi.fn().mockResolvedValue('octocat') }
		};

		await (command as any).executeCommand({
			json: true,
			format: 'json',
			mine: true
		});

		const parsed = JSON.parse(log.mock.calls[0][0]);
		expect(parsed.tasks.map((t: { id: string }) => t.id)).toEqual(['1']);
	});
});
