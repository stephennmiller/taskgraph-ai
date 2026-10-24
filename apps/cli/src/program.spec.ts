/**
 * `taskgraph --help` prints the hand-written HELP_GROUPS list, not the
 * registered commands, so a new command can go missing from it silently, as
 * loop, move, lang, scope-up, scope-down and github did (#219, #364). This
 * checks the list against the built Commander program.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { setupCLI } from './program.js';
import { HELP_GROUPS } from './ui/formatters/help-formatters.js';

// Visible commands left out on purpose; see the HELP_GROUPS comment
const NOT_IN_HELP = new Set([
	'prime', // for agents, named in the footer
	'help',
	'update-subtask', // help points at `note` instead (#245)
	// the old per-tag commands that `tags <…>` replaces
	'add-tag',
	'delete-tag',
	'use-tag',
	'rename-tag',
	'copy-tag'
]);

const program = setupCLI();
const visible = program
	.createHelp()
	.visibleCommands(program)
	.map((c) => c.name());
// A row's name is the command plus an optional `<sub|…>` hint
const rows = HELP_GROUPS.flatMap((g) =>
	g.commands.map((r) => r.name.split(' ')[0])
);

describe('--help rows', () => {
	it('has a row for every visible command', () => {
		const missing = visible.filter(
			(name) => !NOT_IN_HELP.has(name) && !rows.includes(name)
		);
		expect(missing).toEqual([]);
	});

	it('names only registered commands', () => {
		expect(rows.filter((name) => !visible.includes(name))).toEqual([]);
	});

	it('excludes only commands that exist', () => {
		// Keeps the exclusion list from outliving a removed command
		expect([...NOT_IN_HELP].filter((n) => !visible.includes(n))).toEqual([]);
	});
});

describe('setupCLI', () => {
	const originalVersion = process.env.TM_PUBLIC_VERSION;

	afterEach(() => {
		if (originalVersion === undefined) delete process.env.TM_PUBLIC_VERSION;
		else process.env.TM_PUBLIC_VERSION = originalVersion;
	});

	it('is named taskgraph', () => {
		expect(program.name()).toBe('taskgraph');
	});

	it('reports the build-time version', () => {
		process.env.TM_PUBLIC_VERSION = '1.2.3';
		expect(setupCLI().version()).toBe('1.2.3');
	});

	it('reports unknown without a build-time version', () => {
		delete process.env.TM_PUBLIC_VERSION;
		expect(setupCLI().version()).toBe('unknown');
	});
});
