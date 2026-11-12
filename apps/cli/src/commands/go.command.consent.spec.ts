/**
 * @fileoverview `go` settles loop's consent before its first step (#1146):
 * a "no", or no terminal to ask on, stops it before anything is planned.
 * The steps are not run: `spawn` is faked, as is loop's question.
 */

import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', async (importOriginal) => ({
	...(await importOriginal<typeof import('node:child_process')>()),
	spawn: vi.fn()
}));

vi.mock('@tm/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tm/core')>()),
	createTmCore: vi.fn(),
	isLoopTrusted: vi.fn(),
	trustLoop: vi.fn(),
	isTaskGraphProject: vi.fn(),
	resolveProjectRoot: vi.fn()
}));

vi.mock('./loop.command.js', () => ({ confirmLoopTrust: vi.fn() }));

import { spawn } from 'node:child_process';
import {
	createTmCore,
	isLoopTrusted,
	isTaskGraphProject,
	resolveProjectRoot,
	trustLoop
} from '@tm/core';
import { GoCommand } from './go.command.js';
import { confirmLoopTrust } from './loop.command.js';

describe('go consent', () => {
	let dir: string;
	let prd: string;
	/** What happened, in order: each step's command and `trust` when the approval is renewed */
	let events: string[];

	const go = (...args: string[]) =>
		new GoCommand().parseAsync([prd, ...args], { from: 'user' });
	/** The steps `go` started: arguments after the script, and the mark on each */
	const steps = () =>
		vi.mocked(spawn).mock.calls.map(([, args, options]) => ({
			args: (args as string[]).slice(1),
			goStep: options?.env?.TASKGRAPH_GO_STEP
		}));

	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = undefined;
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-go-consent-'));
		prd = path.join(dir, 'prd.md');
		fs.writeFileSync(prd, '# App\n');
		events = [];
		vi.mocked(resolveProjectRoot).mockReturnValue(dir);
		vi.mocked(isTaskGraphProject).mockReturnValue(false);
		vi.mocked(trustLoop).mockImplementation(() => {
			events.push('trust');
		});
		vi.mocked(spawn).mockImplementation(((_cmd: string, args: string[]) => {
			events.push(args[1]);
			const child = new EventEmitter();
			queueMicrotask(() => child.emit('close', 0, null));
			return child;
		}) as never);
	});

	afterEach(() => {
		process.exitCode = undefined;
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it('runs no step when the consent is refused or cannot be asked', async () => {
		vi.mocked(confirmLoopTrust).mockResolvedValue(false);

		await go();

		expect(spawn).not.toHaveBeenCalled();
		expect(trustLoop).not.toHaveBeenCalled();
	});

	it('asks loop’s own question about this project before the first step', async () => {
		vi.mocked(confirmLoopTrust).mockImplementation(async (loop) => {
			// Nothing has run yet when the question comes
			expect(spawn).not.toHaveBeenCalled();
			loop.isTrusted();
			return true;
		});

		await go();

		expect(isLoopTrusted).toHaveBeenCalledWith(dir);
		expect(events).toEqual(['init', 'parse-prd', 'trust', 'loop']);
	});

	it('renews the approval parse-prd withdrew, and loop does not ask again', async () => {
		vi.mocked(confirmLoopTrust).mockResolvedValue(true);

		await go();

		expect(trustLoop).toHaveBeenCalledWith(dir);
		expect(steps().at(-1)).toEqual({
			args: ['loop', '--trust'],
			goStep: undefined
		});
	});

	it('marks the steps before loop, so they print no next step; never loop', async () => {
		vi.mocked(confirmLoopTrust).mockResolvedValue(true);

		await go();

		expect(steps().map((step) => [step.args[0], step.goStep])).toEqual([
			['init', '1'],
			['parse-prd', '1'],
			['loop', undefined]
		]);
	});

	it.each([
		['--trust', ['loop', '--trust']],
		['--sandbox', ['loop', '--sandbox']]
	])('does not ask, or store an approval, with %s', async (flag, loop) => {
		await go(flag);

		expect(confirmLoopTrust).not.toHaveBeenCalled();
		expect(trustLoop).not.toHaveBeenCalled();
		expect(steps().at(-1)?.args).toEqual(loop);
	});

	it('says what it resumes on a rerun, right before loop', async () => {
		vi.mocked(confirmLoopTrust).mockResolvedValue(true);
		vi.mocked(isTaskGraphProject).mockReturnValue(true);
		vi.mocked(createTmCore).mockResolvedValue({
			tasks: {
				getStats: async () => ({
					byStatus: { done: 1, 'in-progress': 1, pending: 1 }
				}),
				getPrimeContext: async () => ({
					inProgress: [{ id: '2', title: 'Task 2' }]
				})
			},
			close: async () => {}
		} as never);
		const log = vi.spyOn(console, 'log').mockImplementation(() => {
			events.push('resuming');
		});

		await go();

		expect(log.mock.calls[0][0]).toContain(
			'Resuming: 1 done, task 2 in progress, 1 pending'
		);
		expect(events).toEqual(['parse-prd', 'trust', 'resuming', 'loop']);
		log.mockRestore();
	});
});
