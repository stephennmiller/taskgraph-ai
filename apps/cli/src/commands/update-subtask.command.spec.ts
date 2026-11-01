/**
 * @fileoverview Unit tests for `update-subtask`: what it hands tm-core, what
 * it prints, and its exit codes. tm-core is mocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tm/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tm/core')>()),
	createTmCore: vi.fn()
}));

vi.mock('../utils/project-root.js', () => ({
	getProjectRoot: () => '/test/project'
}));

vi.mock('../utils/display-helpers.js', () => ({
	displayCommandHeader: () => false
}));

import { createTmCore } from '@tm/core';
import { UpdateSubtaskCommand } from './update-subtask.command.js';

const updateSubtask = vi.fn();
const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');

function run(...args: string[]) {
	return new UpdateSubtaskCommand().parseAsync(args, { from: 'user' });
}

const result = (extra = {}) => ({
	id: '5.2',
	parentId: '5',
	subtask: { id: 2, title: 'Define \x1b]0;pwned\x07the table' },
	added: 'Map ls to list.',
	telemetryData: null,
	tagInfo: null,
	tag: 'master',
	...extra
});

describe('update-subtask', () => {
	let out: string[];
	let err: string[];

	beforeEach(() => {
		vi.clearAllMocks();
		out = [];
		err = [];
		vi.spyOn(console, 'log').mockImplementation((...a) => {
			out.push(strip(a.join(' ')));
		});
		vi.spyOn(console, 'error').mockImplementation((...a) => {
			err.push(strip(a.join(' ')));
		});
		vi.spyOn(process, 'exit').mockImplementation(((code: number) => {
			throw new Error(`exit ${code}`);
		}) as never);
		vi.mocked(createTmCore).mockResolvedValue({
			tasks: { updateSubtask },
			config: { getActiveTag: () => 'master' }
		} as any);
		updateSubtask.mockResolvedValue(result());
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('hands tm-core the ID, prompt, research and tag', async () => {
		await run('--id=5.2', '--prompt=Aliases', '--research', '--tag=feature');

		expect(updateSubtask).toHaveBeenCalledWith(
			{
				id: '5.2',
				prompt: 'Aliases',
				research: true,
				tag: 'feature',
				outputType: 'cli'
			},
			expect.any(Object)
		);
	});

	it('takes the ID as an argument (#882)', async () => {
		await run('5.2', '--prompt=Aliases');

		expect(updateSubtask).toHaveBeenCalledWith(
			expect.objectContaining({ id: '5.2', prompt: 'Aliases' }),
			expect.any(Object)
		);
	});

	it('shows the notes it added, without escape codes', async () => {
		await run('--id=5.2', '--prompt=Aliases');

		const text = out.join('\n');
		expect(text).toContain('Added notes to subtask 5.2');
		expect(text).toContain('Define the table');
		expect(text).toContain('Map ls to list.');
		expect(text).not.toContain('\x1b]0;');
	});

	it('says once when the AI added nothing', async () => {
		updateSubtask.mockResolvedValue(result({ added: '' }));

		await run('--id=5.2', '--prompt=Aliases');

		expect(out.join('\n')).toContain('Nothing added to subtask 5.2');
	});

	it.each([
		[['--prompt=x'], 'Missing subtask ID'],
		[['--id=5.2'], 'Missing --prompt'],
		[['--id=5.2', '--prompt=   '], 'Missing --prompt']
	])('exits 1 for %j', async (args, message) => {
		await expect(run(...args)).rejects.toThrow('exit 1');
		expect(err.join('\n')).toContain(message);
		expect(updateSubtask).not.toHaveBeenCalled();
	});

	it('refuses a --file other than the project tasks.json', async () => {
		await expect(
			run('--id=5.2', '--prompt=x', '--file=other.json')
		).rejects.toThrow('exit 1');
		expect(err.join('\n')).toContain('--file is no longer supported');
		expect(updateSubtask).not.toHaveBeenCalled();
	});

	it('prints a tm-core error once and exits 1', async () => {
		updateSubtask.mockRejectedValue(new Error('Subtask 5.9 not found'));

		await expect(run('--id=5.9', '--prompt=x')).rejects.toThrow('exit 1');
		expect(err.join('\n')).toContain('Subtask 5.9 not found');
	});
});
