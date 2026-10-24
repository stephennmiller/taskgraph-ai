/**
 * @fileoverview Unit tests for `research`: what it hands tm-core, what it
 * prints around the answer, and its exit codes. tm-core is mocked.
 */

import path from 'node:path';
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
import { ResearchCommand } from './research.command.js';

const research = vi.fn();
const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');

function run(...args: string[]) {
	return new ResearchCommand().parseAsync(args, { from: 'user' });
}

const result = (extra = {}) => ({
	query: 'q',
	result: '**Use** \x1b]0;pwned\x07Postgres',
	telemetryData: null,
	exchange: { question: 'q', answer: 'a', type: 'initial', timestamp: '' },
	saveFailures: [],
	...extra
});

describe('research', () => {
	let out: string[];
	let err: string[];

	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = undefined;
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
			tasks: { research },
			config: { getActiveTag: () => 'master' }
		} as any);
		research.mockImplementation(async (_input, hooks) => {
			hooks.onAiCall({
				taskIds: ['3'],
				relatedTaskIds: ['1', '2'],
				files: ['README.md'],
				projectTree: true,
				customContext: false
			});
			hooks.onWarning('big.txt is over 50 KB; left it out of the context');
			return result({ savedTo: { id: '3', title: 'Sign-in' } });
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		process.exitCode = undefined;
	});

	it('hands tm-core every option, parsed', async () => {
		await run(
			'How should we store sessions?',
			'--id=3, 4.1,',
			'--files=README.md,src/a.js',
			'--context=We use Postgres',
			'--tree',
			'--detail=high',
			'--save-to=3',
			'--save-file',
			'--save=notes.md',
			'--tag=feature'
		);

		expect(research).toHaveBeenCalledWith(
			{
				query: 'How should we store sessions?',
				taskIds: ['3', '4.1'],
				filePaths: ['README.md', 'src/a.js'],
				customContext: 'We use Postgres',
				includeProjectTree: true,
				detailLevel: 'high',
				saveTo: '3',
				saveToFile: true,
				saveAs: path.resolve(process.cwd(), 'notes.md'),
				tag: 'feature',
				outputType: 'cli'
			},
			expect.any(Object)
		);
	});

	it('prints the context line, the answer once, and where it saved', async () => {
		await run('q', '--save-to=3');

		const text = out.join('\n');
		expect(text).toContain(
			'Context: task 3 · related 1, 2 · README.md · project tree'
		);
		expect(text).toContain('⚠ big.txt is over 50 KB');
		expect(text.match(/Postgres/g)).toHaveLength(1);
		expect(text).not.toContain('\x1b]0;');
		expect(text).toContain('✓ Saved to task 3');
		expect(process.exitCode).toBeUndefined();
	});

	it('keeps the answer and exits 1 when a save fails', async () => {
		research.mockResolvedValue(
			result({
				saveFailures: [
					{ kind: 'task', id: '3', message: "Task 3 doesn't exist" }
				]
			})
		);

		await run('q', '--save-to=3');

		expect(out.join('\n')).toContain('Postgres');
		expect(out.join('\n')).toContain(
			"✗ Couldn't save to task 3: Task 3 doesn't exist"
		);
		expect(process.exitCode).toBe(1);
	});

	it('asks for a question before calling tm-core', async () => {
		await expect(run()).rejects.toThrow('exit 1');

		expect(err.join('\n')).toContain('Research needs a question');
		expect(research).not.toHaveBeenCalled();
	});

	it('exits 1 with the hint tm-core gives', async () => {
		research.mockRejectedValue(
			Object.assign(new Error("Task 9 doesn't exist in tag 'master'"), {
				hint: 'Run `taskgraph list` to see task IDs'
			})
		);

		await expect(run('q', '--id=9')).rejects.toThrow('exit 1');

		expect(err.join('\n')).toContain("Task 9 doesn't exist");
		expect(err.join('\n')).toContain('taskgraph list');
	});

	it('refuses a --file other than the project tasks file', async () => {
		await expect(run('q', '--file=other.json')).rejects.toThrow('exit 1');

		expect(err.join('\n')).toContain('--file is no longer supported');
		expect(research).not.toHaveBeenCalled();
	});
});
