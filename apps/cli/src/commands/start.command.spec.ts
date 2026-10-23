/**
 * @fileoverview Unit tests for the deprecated `start` alias (#255)
 */

import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { buildCompletionSpec } from '../completion/spec.js';
import {
	StartCommand,
	removedStartFlag,
	startToLoopArgs
} from './start.command.js';

describe('startToLoopArgs', () => {
	it('runs one iteration on the task given as an argument', () => {
		expect(startToLoopArgs('3', {})).toEqual(['-n', '1', '--id', '3']);
	});

	it('takes the task from --id when there is no argument', () => {
		expect(startToLoopArgs(undefined, { id: '3.2' })).toEqual([
			'-n',
			'1',
			'--id',
			'3.2'
		]);
	});

	it('runs one iteration on the next task when no ID is given', () => {
		expect(startToLoopArgs(undefined, {})).toEqual(['-n', '1']);
	});

	it('passes the loop flags it accepts through', () => {
		expect(
			startToLoopArgs('3', {
				project: '/work/app',
				trust: true,
				sandbox: true,
				verbose: true
			})
		).toEqual([
			'-n',
			'1',
			'--id',
			'3',
			'--project',
			'/work/app',
			'--trust',
			'--sandbox',
			'--verbose'
		]);
	});
});

describe('removedStartFlag', () => {
	it('names an old start flag that loop has no equivalent for', () => {
		expect(removedStartFlag({ dryRun: true })).toBe('--dry-run');
		expect(removedStartFlag({ force: true })).toBe('--force');
		expect(removedStartFlag({ statusUpdate: false })).toBe(
			'--no-status-update'
		);
		expect(removedStartFlag({ format: 'json' })).toBe('--format');
	});

	it('is undefined for the flags loop still takes', () => {
		expect(
			removedStartFlag({ id: '3', trust: true, statusUpdate: true })
		).toBeUndefined();
	});
});

describe('StartCommand.register', () => {
	it('keeps start out of help and Tab completion', () => {
		const program = new Command('taskgraph');
		StartCommand.register(program);

		expect(program.helpInformation()).not.toMatch(/^\s+start\b/m);
		expect(
			buildCompletionSpec(program).commands.map((c) => c.name)
		).not.toContain('start');
	});

	it('still runs when called by name', () => {
		const program = new Command('taskgraph');
		const start = StartCommand.register(program);

		expect(program.commands).toContain(start);
		expect(start.name()).toBe('start');
	});
});
