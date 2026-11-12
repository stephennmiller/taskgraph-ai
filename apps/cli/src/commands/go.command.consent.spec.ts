/**
 * @fileoverview `go` settles loop's consent before its first step (#1146):
 * a "no", or no terminal to ask on, stops it before anything is planned. A
 * run that plans new tasks asks even where an approval is stored; a run that
 * only resumes lets it stand. A yes is stored when the loop step starts, for
 * the project loop finds, and not before. The steps are not run: `spawn` is
 * faked, as are loop's question and the stored approval.
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
	isGoTrusted: vi.fn(),
	trustLoop: vi.fn(),
	isTaskGraphProject: vi.fn(),
	resolveProjectRoot: vi.fn()
}));

vi.mock('./loop.command.js', () => ({ confirmLoopTrust: vi.fn() }));

import { spawn } from 'node:child_process';
import {
	createTmCore,
	isGoTrusted,
	isTaskGraphProject,
	resolveProjectRoot,
	trustLoop
} from '@tm/core';
import { GoCommand } from './go.command.js';
import { confirmLoopTrust } from './loop.command.js';

describe('go consent', () => {
	let dir: string;
	let prd: string;
	/** What happened, in order: `asked`, each step's command, and `trust` when the approval is stored */
	let events: string[];
	/** The exit code of each step that fails, by command */
	let failing: Record<string, number>;
	/** An approval for this project is in the user's home */
	let stored: boolean;
	/** What the user answers, or false with no terminal to ask on */
	let answer: boolean;
	const prdHasNewSections = vi.fn();

	const go = (...args: string[]) =>
		new GoCommand().parseAsync([prd, ...args], { from: 'user' });
	/** The steps `go` started: arguments after the script, and the mark on each */
	const steps = () =>
		vi.mocked(spawn).mock.calls.map(([, args, options]) => ({
			args: (args as string[]).slice(1),
			goStep: options?.env?.TASKGRAPH_GO_STEP
		}));
	/** A project whose PRD has, or hasn't, sections with no tasks yet */
	const project = (newSections: boolean) => {
		vi.mocked(isTaskGraphProject).mockReturnValue(true);
		prdHasNewSections.mockResolvedValue(newSections);
	};

	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = undefined;
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-go-consent-'));
		prd = path.join(dir, 'prd.md');
		fs.writeFileSync(prd, '# App\n');
		events = [];
		failing = {};
		stored = false;
		answer = true;
		vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.mocked(resolveProjectRoot).mockReturnValue(dir);
		vi.mocked(isTaskGraphProject).mockReturnValue(false);
		// tm-core's rule, tested in loop-trust.spec.ts
		vi.mocked(isGoTrusted).mockImplementation(
			(_root, plansTasks) => !plansTasks && stored
		);
		vi.mocked(trustLoop).mockImplementation(() => {
			events.push('trust');
		});
		// Loop's own: no question where it is trusted, else the answer, and a
		// yes goes to the `trust` it was handed
		vi.mocked(confirmLoopTrust).mockImplementation(async (loop) => {
			if (loop.isTrusted()) return true;
			events.push('asked');
			if (answer) loop.trust();
			return answer;
		});
		vi.mocked(createTmCore).mockResolvedValue({
			tasks: {
				prdHasNewSections,
				getStats: async () => ({ byStatus: { done: 1, pending: 1 } }),
				getPrimeContext: async () => ({ inProgress: [] })
			},
			close: async () => {}
		} as never);
		vi.mocked(spawn).mockImplementation(((_cmd: string, args: string[]) => {
			events.push(args[1]);
			const child = new EventEmitter();
			queueMicrotask(() => child.emit('close', failing[args[1]] ?? 0, null));
			return child;
		}) as never);
	});

	afterEach(() => {
		process.exitCode = undefined;
		vi.restoreAllMocks();
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it.each([
		['--trust', ['loop', '--trust']],
		['--sandbox', ['loop', '--sandbox']]
	])('with %s: no question and no approval stored', async (flag, loop) => {
		project(true);

		await go(flag);

		expect(confirmLoopTrust).not.toHaveBeenCalled();
		expect(trustLoop).not.toHaveBeenCalled();
		expect(steps().at(-1)?.args).toEqual(loop);
	});

	describe('a run that plans new tasks', () => {
		it('asks before the first step even where an approval is stored', async () => {
			project(true);
			stored = true;

			await go();

			expect(prdHasNewSections).toHaveBeenCalledWith({ prdPath: prd });
			// One question; the yes covers the tasks planned, so loop gets --trust
			expect(events).toEqual(['asked', 'parse-prd', 'trust', 'loop']);
			expect(steps().at(-1)?.args).toEqual(['loop', '--trust']);
		});

		it('runs no step on a "no", or with no terminal to ask on', async () => {
			project(true);
			stored = true;
			answer = false;

			await go();

			expect(events).toEqual(['asked']);
		});

		it('asks in a folder that is not a project yet, which it sets up', async () => {
			stored = true;

			await go();

			expect(createTmCore).not.toHaveBeenCalled();
			expect(events).toEqual(['asked', 'init', 'parse-prd', 'trust', 'loop']);
		});

		it('stores the yes for the project init made, not the folder above it', async () => {
			// `go` in repo/app: the root found is the repository until init
			// makes the project in repo/app
			const app = path.join(dir, 'app');
			let root = dir;
			vi.mocked(resolveProjectRoot).mockImplementation(() => root);
			vi.mocked(spawn).mockImplementation(((_cmd: string, args: string[]) => {
				events.push(args[1]);
				if (args[1] === 'init') root = app;
				const child = new EventEmitter();
				queueMicrotask(() => child.emit('close', 0, null));
				return child;
			}) as never);
			// An approval for the repository doesn't answer for the new project
			stored = true;

			await go();

			// Once, as the loop step starts: loop then finds its own folder approved
			expect(events).toEqual(['asked', 'init', 'parse-prd', 'trust', 'loop']);
			expect(vi.mocked(trustLoop).mock.calls).toEqual([[app]]);
		});

		it('stores nothing when planning fails', async () => {
			project(true);
			failing = { 'parse-prd': 1 };

			await go();

			expect(events).toEqual(['asked', 'parse-prd']);
			expect(trustLoop).not.toHaveBeenCalled();
			expect(process.exitCode).toBe(1);
		});

		it('asks when it cannot tell whether the PRD has new sections', async () => {
			project(false);
			stored = true;
			prdHasNewSections.mockRejectedValue(new Error('tasks.json is not JSON'));

			await go();

			expect(events[0]).toBe('asked');
		});
	});

	describe('a run that only resumes', () => {
		it('lets a stored approval stand, and leaves the check to loop', async () => {
			project(false);
			stored = true;

			await go();

			// As `taskgraph loop` would run: nothing asked, stored or passed on
			expect(events).toEqual(['parse-prd', 'loop']);
			expect(steps().at(-1)?.args).toEqual(['loop']);
		});

		it('asks when no approval is stored', async () => {
			project(false);

			await go();

			expect(events).toEqual(['asked', 'parse-prd', 'trust', 'loop']);
		});
	});

	it('marks the steps before loop, so they print no next step; never loop', async () => {
		await go();

		expect(steps().map((step) => [step.args[0], step.goStep])).toEqual([
			['init', '1'],
			['parse-prd', '1'],
			['loop', undefined]
		]);
	});

	it('says what it resumes on a rerun, right before loop', async () => {
		project(false);
		stored = true;
		vi.mocked(createTmCore).mockResolvedValue({
			tasks: {
				prdHasNewSections,
				getStats: async () => ({
					byStatus: { done: 1, 'in-progress': 1, pending: 1 }
				}),
				getPrimeContext: async () => ({
					inProgress: [{ id: '2', title: 'Task 2' }]
				})
			},
			close: async () => {}
		} as never);
		vi.mocked(console.log).mockImplementation(() => {
			events.push('resuming');
		});

		await go();

		expect(vi.mocked(console.log).mock.calls[0][0]).toContain(
			'Resuming: 1 done, task 2 in progress, 1 pending'
		);
		expect(events).toEqual(['parse-prd', 'resuming', 'loop']);
	});
});
