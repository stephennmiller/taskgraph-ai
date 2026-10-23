/**
 * Every command that takes `--format` also takes `--json` as its shorthand
 * (issue #250), so agents can pass `--json` to any of them.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { ArchiveCommand } from './archive.command.js';
import { GenerateCommand } from './generate.command.js';
import { GraphCommand } from './graph.command.js';
import { ListTasksCommand } from './list.command.js';
import { NextCommand } from './next.command.js';
import { SetStatusCommand } from './set-status.command.js';
import { ShowCommand } from './show.command.js';
import { WhyCommand } from './why.command.js';

/** The command and its subcommands, each with its full name */
function withSubcommands(command: Command, prefix = ''): [string, Command][] {
	const name = `${prefix}${command.name()}`;
	return [
		[name, command],
		...command.commands.flatMap((sub) => withSubcommands(sub, `${name} `))
	];
}

const commands = [
	new ArchiveCommand(),
	new GenerateCommand(),
	new GraphCommand(),
	new ListTasksCommand(),
	new NextCommand(),
	new SetStatusCommand(),
	new ShowCommand(),
	new WhyCommand()
].flatMap((command) => withSubcommands(command));

/**
 * Command source files that define a --format option. The deprecated `start`
 * keeps a hidden --format only to say it is gone, so it isn't one of them.
 */
const COMMANDS_DIR = dirname(fileURLToPath(import.meta.url));
const filesWithFormat = readdirSync(COMMANDS_DIR, { recursive: true })
	.map(String)
	.filter((file) => file.endsWith('.command.ts'))
	.filter((file) =>
		/--format <format>',\s*'Output format/.test(
			readFileSync(join(COMMANDS_DIR, file), 'utf8')
		)
	)
	.sort();

const withFormat = commands.filter(([, command]) =>
	command.options.some((option) => option.long === '--format' && !option.hidden)
);

describe('--json alias', () => {
	it('checks every command file that defines --format', () => {
		expect(filesWithFormat).toEqual([
			'archive.command.ts',
			'generate.command.ts',
			'graph.command.ts',
			'list.command.ts',
			'next.command.ts',
			'set-status.command.ts',
			'show.command.ts',
			'why.command.ts'
		]);
	});

	it('finds --format on each of those commands', () => {
		expect(withFormat.map(([name]) => name)).toEqual([
			'archive',
			'archive restore',
			'generate',
			'graph',
			'list',
			'next',
			'set-status',
			'show',
			'why'
		]);
	});

	it.each(withFormat)('%s takes --json', (_name, command) => {
		expect(command.options.map((option) => option.long)).toContain('--json');
	});
});
