/**
 * The confirmation `taskgraph tags remove` asks in a terminal: no, Ctrl-C,
 * yes, and refusing without a terminal. The prompt is mocked; the tasks
 * file is real.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { vi } from 'vitest';

const { answer } = vi.hoisted(() => ({ answer: vi.fn() }));

vi.mock('inquirer', () => ({
	default: { createPromptModule: () => answer }
}));

import { deleteTag } from '../../../scripts/modules/task-manager/tag-management.js';

describe('deleteTag confirmation', () => {
	let dir;
	let tasksPath;
	let log;
	const tty = {};

	const setTTY = (value) => {
		for (const stream of [process.stdin, process.stdout]) {
			Object.defineProperty(stream, 'isTTY', { value, configurable: true });
		}
	};

	const remove = () =>
		deleteTag(tasksPath, 'backup', {}, { projectRoot: dir }, 'text');
	const tagsOnDisk = () =>
		Object.keys(JSON.parse(fs.readFileSync(tasksPath, 'utf8')));

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-delete-tag-'));
		tasksPath = path.join(dir, 'tasks.json');
		const tasks = [{ id: 1, title: 'A', status: 'pending', dependencies: [] }];
		fs.writeFileSync(
			tasksPath,
			JSON.stringify({ master: { tasks }, backup: { tasks } })
		);
		tty.stdin = process.stdin.isTTY;
		tty.stdout = process.stdout.isTTY;
		log = vi.spyOn(console, 'log').mockImplementation(() => {});
		answer.mockReset();
	});

	afterEach(() => {
		Object.defineProperty(process.stdin, 'isTTY', {
			value: tty.stdin,
			configurable: true
		});
		Object.defineProperty(process.stdout, 'isTTY', {
			value: tty.stdout,
			configurable: true
		});
		vi.restoreAllMocks();
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it('asks once, and "no" deletes nothing', async () => {
		setTTY(true);
		answer.mockResolvedValue({ proceed: false });

		const result = await remove();

		expect(answer).toHaveBeenCalledTimes(1);
		expect(answer.mock.calls[0][0][0].message).toBe(
			"Delete tag backup and its task? This can't be undone."
		);
		expect(result).toEqual({
			tagName: 'backup',
			deleted: false,
			cancelled: true
		});
		expect(log).toHaveBeenCalledWith(
			expect.stringContaining('Cancelled; nothing was deleted')
		);
		expect(tagsOnDisk()).toEqual(['master', 'backup']);
	});

	it('Ctrl-C deletes nothing and exits 130', async () => {
		setTTY(true);
		answer.mockRejectedValue(
			Object.assign(new Error('User force closed the prompt'), {
				name: 'ExitPromptError'
			})
		);
		const exit = vi.spyOn(process, 'exit').mockImplementation((code) => {
			throw new Error(`exit ${code}`);
		});

		await expect(remove()).rejects.toThrow('exit 130');

		expect(exit).toHaveBeenCalledWith(130);
		expect(tagsOnDisk()).toEqual(['master', 'backup']);
	});

	it('"yes" deletes the tag', async () => {
		setTTY(true);
		answer.mockResolvedValue({ proceed: true });

		const result = await remove();

		expect(result).toMatchObject({ deleted: true, tasksDeleted: 1 });
		expect(tagsOnDisk()).toEqual(['master']);
	});

	it('without a terminal, refuses with a hint instead of asking', async () => {
		setTTY(false);

		await expect(remove()).rejects.toMatchObject({
			message: 'Deleting tag backup and its task needs confirmation',
			hint: 'Pass `--yes` to delete it without asking'
		});
		expect(answer).not.toHaveBeenCalled();
		expect(tagsOnDisk()).toEqual(['master', 'backup']);
	});

	it('keeps what another process wrote while the question was open', async () => {
		setTTY(true);
		answer.mockImplementation(async () => {
			const current = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
			current.master.tasks.push({
				id: 2,
				title: 'Added meanwhile',
				status: 'pending',
				dependencies: []
			});
			fs.writeFileSync(tasksPath, JSON.stringify(current));
			return { proceed: true };
		});

		await remove();

		const saved = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
		expect(Object.keys(saved)).toEqual(['master']);
		expect(saved.master.tasks.map((t) => t.title)).toEqual([
			'A',
			'Added meanwhile'
		]);
	});
});
