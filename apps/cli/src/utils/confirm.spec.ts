/**
 * @fileoverview The shared yes/no question (#1146): cleared when answered,
 * one muted line for "no" and for Ctrl-C, and exit 130 for Ctrl-C. Only
 * inquirer, which needs a terminal, is faked.
 */

import { stripVTControlCharacters } from 'node:util';
import {
	type Mock,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi
} from 'vitest';

vi.mock('inquirer', () => {
	const ask = vi.fn();
	return { default: { createPromptModule: vi.fn(() => ask), ask } };
});

import inquirer from 'inquirer';
import { confirm } from './confirm.js';

const ask = (inquirer as unknown as { ask: Mock }).ask;

describe('confirm', () => {
	let printed: string[];

	beforeEach(() => {
		vi.clearAllMocks();
		printed = [];
		vi.spyOn(console, 'log').mockImplementation((...args) => {
			printed.push(stripVTControlCharacters(args.join(' ')));
		});
		vi.spyOn(process, 'exit').mockImplementation(((code: number) => {
			throw new Error(`exit ${code}`);
		}) as never);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('asks a question that defaults to no and is cleared once answered', async () => {
		ask.mockResolvedValue({ yes: true });

		expect(await confirm('Delete task 3?', 'Cancelled; nothing changed')).toBe(
			true
		);

		expect(inquirer.createPromptModule).toHaveBeenCalledWith({
			clearPromptOnDone: true
		});
		expect(ask.mock.calls[0][0][0]).toMatchObject({
			type: 'confirm',
			message: 'Delete task 3?',
			default: false
		});
		expect(printed).toEqual([]);
	});

	it('prints the one cancel line on "no"', async () => {
		ask.mockResolvedValue({ yes: false });

		expect(await confirm('Delete task 3?', 'Cancelled; nothing changed')).toBe(
			false
		);

		expect(printed).toEqual(['Cancelled; nothing changed']);
		expect(process.exit).not.toHaveBeenCalled();
	});

	it('prints the same line and exits 130 on Ctrl-C', async () => {
		ask.mockRejectedValue(
			Object.assign(new Error('User force closed the prompt with SIGINT'), {
				name: 'ExitPromptError'
			})
		);

		await expect(
			confirm('Delete task 3?', 'Cancelled; nothing changed')
		).rejects.toThrow('exit 130');

		expect(printed).toEqual(['Cancelled; nothing changed']);
	});

	it('passes on any other failure', async () => {
		ask.mockRejectedValue(new Error('no tty'));

		await expect(confirm('Delete task 3?', 'Cancelled')).rejects.toThrow(
			'no tty'
		);

		expect(printed).toEqual([]);
	});
});
