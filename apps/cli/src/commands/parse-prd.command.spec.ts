/**
 * @fileoverview Unit tests for `parse-prd`: what it hands tm-core, the
 * overwrite prompt, --clarify's flags, what it prints, and its exit codes.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tm/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tm/core')>()),
	createTmCore: vi.fn()
}));

vi.mock('../utils/project-root.js', () => ({
	getProjectRoot: () => process.env.TASKGRAPH_PROJECT_ROOT
}));

vi.mock('../utils/display-helpers.js', () => ({
	displayCommandHeader: () => false
}));

import { createTmCore } from '@tm/core';
import { ParsePrdCommand } from './parse-prd.command.js';

const parsePrd = vi.fn();
const parsePrdTarget = vi.fn();
const findPrdGaps = vi.fn();
const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');

function run(...args: string[]) {
	return new ParsePrdCommand().parseAsync(args, { from: 'user' });
}

describe('parse-prd', () => {
	let dir: string;
	let prd: string;
	let out: string[];
	let err: string[];
	const isTTY = process.stdin.isTTY;

	beforeEach(() => {
		vi.clearAllMocks();
		dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tg-prd-')));
		prd = path.join(dir, 'prd.md');
		fs.writeFileSync(prd, '# App\n');
		vi.spyOn(process, 'cwd').mockReturnValue(dir);
		process.env.TASKGRAPH_PROJECT_ROOT = dir;
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
			tasks: { parsePrd, parsePrdTarget, findPrdGaps }
		} as any);
		parsePrdTarget.mockResolvedValue({
			prdPath: prd,
			tag: 'master',
			taskCount: 0
		});
		parsePrd.mockResolvedValue({
			tag: 'master',
			prdPath: prd,
			tasksPath: path.join(dir, '.taskgraph/tasks/tasks.json'),
			added: 3,
			total: 3,
			prdDelta: null,
			telemetryData: null,
			tagInfo: null,
			estimatedInputTokens: 10
		});
	});

	afterEach(() => {
		process.stdin.isTTY = isTTY;
		delete process.env.TASKGRAPH_PROJECT_ROOT;
		vi.restoreAllMocks();
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it('streams the tasks from the PRD it was given and says where they went', async () => {
		await run('prd.md', '-n', '4', '--research', '--tag', 'feature');

		expect(parsePrdTarget).toHaveBeenCalledWith({
			prdPath: prd,
			tag: 'feature'
		});
		expect(parsePrd).toHaveBeenCalledWith(
			{
				prdPath: prd,
				numTasks: '4',
				force: false,
				append: false,
				research: true,
				tag: 'master',
				stream: true,
				outputType: 'cli'
			},
			expect.any(Object)
		);
		expect(out.join('\n')).toContain(
			'Saved to .taskgraph/tasks/tasks.json · research-backed'
		);
	});

	it('refuses a PRD that does not exist before starting tm-core', async () => {
		await expect(run('missing.md')).rejects.toThrow('exit 1');

		expect(err.join('\n')).toContain('missing.md not found');
		expect(createTmCore).not.toHaveBeenCalled();
	});

	it.each([
		[['--json'], '--json only works with --clarify'],
		[['--yes'], '--yes only works with --clarify'],
		[
			['--clarify', '--answers', '-'],
			'--clarify and --answers both supply the answers'
		]
	])('refuses %s before any AI call', async (flags, message) => {
		await expect(run('prd.md', ...flags)).rejects.toThrow('exit 1');

		expect(err.join('\n')).toContain(message);
		expect(parsePrd).not.toHaveBeenCalled();
	});

	it('refuses an --output other than the project tasks file', async () => {
		await expect(run('prd.md', '-o', 'other.json')).rejects.toThrow('exit 1');

		expect(err.join('\n')).toContain('--output is no longer supported');
		expect(parsePrd).not.toHaveBeenCalled();
	});

	it('without a terminal, fails instead of asking to replace the tag tasks', async () => {
		process.stdin.isTTY = false;
		parsePrdTarget.mockResolvedValue({
			prdPath: prd,
			tag: 'master',
			taskCount: 2
		});

		await expect(run('prd.md')).rejects.toThrow('exit 1');

		const printed = err.join('\n');
		expect(printed).toContain("there's no terminal to ask");
		expect(printed).toContain('--append');
		expect(printed).toContain('--force');
		expect(parsePrd).not.toHaveBeenCalled();
	});

	it('replaces the tasks without asking with --force', async () => {
		parsePrdTarget.mockResolvedValue({
			prdPath: prd,
			tag: 'master',
			taskCount: 2
		});

		await run('prd.md', '--force');

		expect(parsePrd.mock.calls[0][0]).toMatchObject({ force: true });
	});

	it('--clarify --json prints only the questions', async () => {
		const questions = [{ question: 'Which DB?', suggestedAnswer: 'SQLite' }];
		findPrdGaps.mockResolvedValue({
			prdPath: prd,
			questions,
			telemetryData: null
		});

		await run('prd.md', '--clarify', '--json');

		expect(JSON.parse(out.join('\n'))).toMatchObject({
			prd: 'prd.md',
			questions
		});
		expect(parsePrd).not.toHaveBeenCalled();
	});

	it('prints only the PRD changes when an append finds nothing new', async () => {
		parsePrd.mockImplementation(async (_input, hooks) => {
			const delta = {
				path: 'prd.md',
				known: true,
				added: [],
				changed: [],
				removed: []
			};
			hooks.onPrdDelta(delta);
			return { tasksPath: 'tasks.json', prdDelta: delta, added: 0, total: 2 };
		});

		await run('prd.md', '--append');

		expect(out.join('\n')).not.toContain('Saved to');
	});

	it('says why it failed, once, and exits 1', async () => {
		parsePrd.mockRejectedValue(new Error('Claude is \x1b[31moverloaded'));

		await expect(run('prd.md')).rejects.toThrow('exit 1');

		const printed = err.join('\n');
		expect(printed).toContain("Couldn't generate tasks: Claude is overloaded");
		expect(printed).toContain('Claude is busy');
	});
});
