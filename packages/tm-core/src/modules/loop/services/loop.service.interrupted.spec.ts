/**
 * @fileoverview An iteration that starts on an in-progress task with
 * uncommitted changes is told which files hold its work (#998)
 */

import * as childProcess from 'node:child_process';
import * as fsPromises from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskStatus } from '../../../common/types/index.js';
import type { LoopConfig } from '../types.js';
import { fakeClaude } from './fake-claude.js';
import { LoopService } from './loop.service.js';

vi.mock('node:child_process');
vi.mock('node:fs/promises');

const config = (fields: Partial<LoopConfig> = {}): LoopConfig => ({
	prompt: 'default',
	iterations: 1,
	sleepSeconds: 0,
	progressFile: '/test/progress.txt',
	...fields
});

/** The prompt the first iteration ran with */
const prompt = () => {
	const args = vi.mocked(childProcess.spawn).mock.calls[0][1] as string[];
	return args[args.indexOf('-p') + 1];
};

const LINE = 'was interrupted';

describe('LoopService interrupted task', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
		vi.mocked(fsPromises.appendFile).mockResolvedValue(undefined);
		vi.mocked(childProcess.spawn).mockImplementation(
			() => fakeClaude({ stdout: 'Done' }) as never
		);
	});

	const service = (status: TaskStatus, files: string[] | Error) =>
		new LoopService({
			projectRoot: '/test/project',
			findReadyTask: async () => '2',
			taskStatuses: async () =>
				new Map<string, TaskStatus>([
					['2', status],
					['3.1', status]
				]),
			uncommittedFiles: async () => {
				if (files instanceof Error) throw files;
				return files;
			}
		});

	it('names the files the task taskgraph next picks left uncommitted', async () => {
		await service('in-progress', ['src/a.ts']).run(config());

		expect(prompt()).toContain(
			'Task 2 was interrupted. These files have its uncommitted changes: "src/a.ts".'
		);
	});

	it('names them for a pinned in-progress subtask', async () => {
		await service('in-progress', ['src/a.ts']).run(config({ taskId: '3.1' }));

		expect(prompt()).toContain('Task 3.1 was interrupted.');
	});

	it('says nothing when the tree is clean', async () => {
		await service('in-progress', []).run(config());

		expect(prompt()).not.toContain(LINE);
	});

	it('says nothing for a pending task', async () => {
		await service('pending', ['src/a.ts']).run(config());

		expect(prompt()).not.toContain(LINE);
	});

	it('says nothing when git fails', async () => {
		await service('in-progress', new Error('not a git repository')).run(
			config()
		);

		expect(prompt()).not.toContain(LINE);
	});

	it('tells a sandboxed session to look for itself, without asking git on the host (#1133)', async () => {
		const uncommittedFiles = vi.fn(async () => ['src/a.ts']);
		const sandboxed = new LoopService({
			projectRoot: '/test/project',
			findReadyTask: async () => '2',
			taskStatuses: async () =>
				new Map<string, TaskStatus>([['2', 'in-progress']]),
			uncommittedFiles
		});

		await sandboxed.run(config({ sandbox: true }));

		expect(prompt()).toContain(
			'Task 2 was in progress when an earlier run stopped. Run git status, and if it shows uncommitted changes, check them and continue from them rather than starting over.'
		);
		expect(prompt()).not.toContain('src/a.ts');
		expect(uncommittedFiles).not.toHaveBeenCalled();
	});

	it('says nothing to a sandboxed session that starts on a pending task', async () => {
		await service('pending', ['src/a.ts']).run(config({ sandbox: true }));

		expect(prompt()).not.toContain('earlier run stopped');
	});
});
