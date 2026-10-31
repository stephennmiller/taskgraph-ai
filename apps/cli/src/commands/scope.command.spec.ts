/**
 * @fileoverview Unit tests for `scope <ids> up|down` and its hidden aliases
 * `scope-up` / `scope-down`: what they hand
 * tm-core, what they print, and their exit codes.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

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
import {
	ScopeCommand,
	ScopeDownCommand,
	ScopeUpCommand
} from './scope.command.js';

const scope = vi.fn();
const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');

describe('scope-up / scope-down', () => {
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
			tasks: { scope },
			config: { getActiveTag: () => 'master' }
		} as any);
		scope.mockImplementation(async (_input, hooks) => {
			hooks.onWarning('Failed to regenerate subtasks for task 3: \x1b[31mboom');
			return {
				tag: 'master',
				tasks: [
					{
						task: { id: '3', title: 'Bigger' },
						regenerated: true,
						preserved: 1,
						generated: 4
					}
				],
				telemetryData: null
			};
		});
	});

	it('passes the options to tm-core and prints the result and warnings', async () => {
		await new ScopeUpCommand().parseAsync(
			['--id=3', '--strength=heavy', '--prompt=Security', '--research'],
			{ from: 'user' }
		);

		expect(scope).toHaveBeenCalledWith(
			{
				ids: '3',
				direction: 'up',
				strength: 'heavy',
				prompt: 'Security',
				research: true,
				tag: 'master',
				outputType: 'cli'
			},
			expect.any(Object)
		);
		const text = out.join('\n');
		expect(text).toContain('⚠ Failed to regenerate subtasks for task 3: boom');
		expect(text).toContain(
			'✓ Scoped up 1 task\n  3  Bigger · 1 subtask kept, 4 new'
		);
	});

	it('defaults to regular strength and scopes down', async () => {
		await new ScopeDownCommand().parseAsync(['-i', '1,2'], { from: 'user' });

		expect(scope).toHaveBeenCalledWith(
			expect.objectContaining({
				ids: '1,2',
				direction: 'down',
				strength: 'regular'
			}),
			expect.any(Object)
		);
	});

	it('scope <ids> down scopes down (#882)', async () => {
		await new ScopeCommand().parseAsync(['1,2', 'down', '-s', 'light'], {
			from: 'user'
		});

		expect(scope).toHaveBeenCalledWith(
			expect.objectContaining({
				ids: '1,2',
				direction: 'down',
				strength: 'light'
			}),
			expect.any(Object)
		);
	});

	it('scope without up or down exits 1 before tm-core', async () => {
		await expect(
			new ScopeCommand().parseAsync(['3'], { from: 'user' })
		).rejects.toThrow('exit 1');
		expect(err.join('\n')).toContain('taskgraph scope 3 up');
		expect(createTmCore).not.toHaveBeenCalled();
	});

	it('scope rejects a direction other than up or down', async () => {
		const command = new ScopeCommand()
			.exitOverride()
			.configureOutput({ writeErr: () => {} });

		await expect(
			command.parseAsync(['3', 'sideways'], { from: 'user' })
		).rejects.toThrow(/sideways/);
		expect(scope).not.toHaveBeenCalled();
	});

	it('exits 1 without --id, before tm-core', async () => {
		await expect(
			new ScopeUpCommand().parseAsync([], { from: 'user' })
		).rejects.toThrow('exit 1');
		expect(err.join('\n')).toContain('taskgraph scope-up --id=1,2,3');
		expect(createTmCore).not.toHaveBeenCalled();
	});

	it('exits 1 when tm-core refuses the input', async () => {
		scope.mockRejectedValue(new Error('Invalid strength level: max'));

		await expect(
			new ScopeDownCommand().parseAsync(['--id=3', '--strength=max'], {
				from: 'user'
			})
		).rejects.toThrow('exit 1');
		expect(err.join('\n')).toContain('Invalid strength level: max');
	});

	it('refuses a --file other than the project tasks file', async () => {
		await expect(
			new ScopeUpCommand().parseAsync(['--id=3', '--file=other.json'], {
				from: 'user'
			})
		).rejects.toThrow('exit 1');
		expect(scope).not.toHaveBeenCalled();
	});
});
