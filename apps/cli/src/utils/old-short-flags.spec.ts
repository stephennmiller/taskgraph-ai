/**
 * @fileoverview Each short flag means one thing in every command (#1155),
 * and each spelling that changed fails with a hint naming the long form.
 */

import type { Command } from 'commander';
import { describe, expect, it, vi } from 'vitest';
import { setupCLI } from '../program.js';
import {
	OLD_SHORT_FLAGS,
	oldShortFlagHint,
	typedOldShortFlagHint
} from './old-short-flags.js';

const program = setupCLI();
// Every command and subcommand, with its path (`tags use`)
const all = (c: Command, path: string): [string, Command][] => [
	[path, c],
	...c.commands.flatMap((s) => all(s, `${path} ${s.name()}`.trim()))
];
const commands = all(program, '');

/**
 * `-n` is how many to make or run, under the long name each command already
 * had. Every other letter has one long name.
 */
const SAME_MEANING: Record<string, string[]> = {
	'-n': ['--iterations', '--num', '--num-tasks']
};

describe('one meaning per short flag (#1155)', () => {
	it('gives no letter two long names anywhere in the program', () => {
		const longs = new Map<string, Set<string>>();
		for (const [, c] of commands) {
			for (const o of c.options) {
				if (!o.short || !o.long) continue;
				longs.set(o.short, (longs.get(o.short) ?? new Set()).add(o.long));
			}
		}
		const clashes = [...longs]
			.map(([short, names]) => [short, [...names].sort()] as const)
			.filter(
				([short, names]) =>
					names.length > 1 &&
					names.join() !== (SAME_MEANING[short] ?? []).join()
			);
		expect(clashes).toEqual([]);
	});

	it.each([
		['--tag', '-t'],
		['--format', '-f'],
		['--id', '-i'],
		['--status', '-s']
	])('%s has %s on every command that takes it', (long, short) => {
		const without = commands.flatMap(([path, c]) =>
			c.options
				.filter((o) => o.long === long && o.short !== short)
				.map(() => path)
		);
		expect(without).toEqual([]);
	});
});

describe('old spellings (#882, #1155)', () => {
	const strip = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '');
	const rows = OLD_SHORT_FLAGS.flatMap(([letter, was, names]) =>
		names.split(' ').map((name) => [name, letter, was] as const)
	);

	/** stderr of a run that Commander stops before the command's action */
	function parseError(args: string[]): string {
		const stderr = vi
			.spyOn(process.stderr, 'write')
			.mockImplementation(() => true);
		const exit = vi.spyOn(process, 'exit').mockImplementation((code) => {
			throw new Error(`exit ${code ?? 0}`);
		});
		try {
			expect(() => setupCLI().parse(args, { from: 'user' })).toThrow('exit 1');
			return strip(stderr.mock.calls.flat().join(''));
		} finally {
			stderr.mockRestore();
			exit.mockRestore();
		}
	}

	it.each(rows)('%s -%s names %s', (name, letter, was) => {
		const command = program.commands.find((c) => c.name() === name);
		const now = command?.options.find((o) => o.short === `-${letter}`);

		// The long form the hint names is still there, without the letter
		expect(command?.options.map((o) => o.long)).toContain(was);
		expect(now?.long).not.toBe(was);
		expect(oldShortFlagHint(name, letter)).toMatch(
			new RegExp(`^-${letter} means .+; write ${was} in full$`)
		);
		// -p and -t are other options here now, checked through the built CLI
		// (short-flags.command.test.ts); the rest stop in the parser
		if (!now) {
			expect(parseError([name, `-${letter}`])).toBe(
				`✗ Unknown option '-${letter}'\n  ${oldShortFlagHint(name, letter)}\n`
			);
		}
	});

	it('has no hint for a letter that never changed on the command', () => {
		expect(oldShortFlagHint('list', 't')).toBeUndefined();
		expect(oldShortFlagHint('show', 'f')).toBeUndefined();
		expect(parseError(['list', '-x'])).toContain('taskgraph list --help');
	});

	it('gives the hint only when the short form was typed', () => {
		const hint = '-t means --tag; write --title in full';

		expect(typedOldShortFlagHint('add-task', 't', ['-t', 'x'])).toBe(hint);
		expect(typedOldShortFlagHint('add-task', 't', ['-tx'])).toBe(hint);
		expect(typedOldShortFlagHint('add-task', 't', ['-rt', 'x'])).toBe(hint);
		expect(
			typedOldShortFlagHint('add-task', 't', ['--tag', 'x'])
		).toBeUndefined();
		expect(typedOldShortFlagHint('list', 't', ['-t', 'x'])).toBeUndefined();
	});
});
