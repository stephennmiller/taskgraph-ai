/**
 * @fileoverview A parallel worker must not install an update.
 * The parent sets a marker and TASKGRAPH_SKIP_AUTO_UPDATE=1 on the child.
 */

import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./task-worktrees.js', () => ({
	TaskWorktrees: class {
		head() {
			return Promise.resolve('abc123');
		}
		assertClean() {
			return Promise.resolve();
		}
		prepareWorktreesDir() {}
		ignoreWorktreesDir() {
			return Promise.resolve();
		}
		add() {
			return Promise.resolve({ createdBranch: true });
		}
		projectIn(dir: string) {
			return Promise.resolve(dir);
		}
		work() {
			return Promise.resolve({ commits: 0, uncommitted: false });
		}
		remove() {
			return Promise.resolve(true);
		}
	}
}));

import { DEFAULT_LOOP_BANDS } from '../model-bands.js';
import { ParallelLoopRunner } from './parallel-runner.js';

describe('ParallelLoopRunner', () => {
	let root: string;

	afterEach(() => {
		if (root) fs.rmSync(root, { recursive: true, force: true });
	});

	it('marks each worker and skips auto-update', async () => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-parallel-'));
		fs.mkdirSync(path.join(root, '.taskgraph', 'worktrees'), {
			recursive: true
		});
		const tasks = {
			getDependencyTree: async () => ({ waves: { waves: [['1']] } }),
			claimNext: async () => ({ task: { id: '1', title: 'Write the lock' } }),
			get: async () => ({ task: { status: 'pending', metadata: {} } }),
			updateStatus: async () => {}
		};
		const spawner = vi.fn(
			(
				_command: string,
				_args: string[],
				_options: { env?: NodeJS.ProcessEnv }
			) => {
				const child = new EventEmitter() as EventEmitter & {
					pid: number;
					kill: () => void;
				};
				child.pid = 4242;
				child.kill = () => {};
				setImmediate(() => child.emit('close', 0, null));
				return child;
			}
		);

		await new ParallelLoopRunner(root, tasks as never, () => 'master').run({
			parallel: 1,
			spawner: spawner as never
		});

		expect(spawner).toHaveBeenCalledTimes(1);
		const env: NodeJS.ProcessEnv = spawner.mock.calls[0]?.[2].env ?? {};
		expect(env).toMatchObject({
			TASKGRAPH_PARALLEL_WORKER: '1',
			TASKGRAPH_SKIP_AUTO_UPDATE: '1',
			TASKGRAPH_PROJECT_ROOT: path.resolve(root)
		});
		expect(env.TASKGRAPH_LOOP_CHILD).toBeUndefined();
	});

	it("runs each task at the model and effort its complexity picks, with --model's override", async () => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-parallel-'));
		fs.mkdirSync(path.join(root, '.taskgraph', 'worktrees'), {
			recursive: true
		});
		const tasks = {
			getDependencyTree: async () => ({ waves: { waves: [['1']] } }),
			claimNext: async () => ({ task: { id: '1', title: 'Write the lock' } }),
			get: async () => ({
				task: { status: 'pending', metadata: {}, complexity: 2 }
			}),
			updateStatus: async () => {}
		};
		const spawner = vi.fn(() => {
			const child = new EventEmitter() as EventEmitter & {
				pid: number;
				kill: () => void;
			};
			child.pid = 4242;
			child.kill = () => {};
			setImmediate(() => child.emit('close', 0, null));
			return child;
		});

		const result = await new ParallelLoopRunner(
			root,
			tasks as never,
			() => 'master',
			DEFAULT_LOOP_BANDS
		).run({ parallel: 1, model: 'opus', spawner: spawner as never });

		const args: string[] = (spawner.mock.calls[0] as unknown[])[1] as never;
		expect(args.slice(-4)).toEqual(['--model', 'opus', '--effort', 'low']);
		expect(result.tasks[0]).toMatchObject({ model: 'opus', effort: 'low' });
	});
});
