/**
 * @fileoverview Tests for the full slash command set
 *
 * Every command works on the local tasks file: there is no solo/team operating
 * mode and no Hamster command (issue #16).
 */

import { describe, expect, it } from 'vitest';
import * as commandModule from './index.js';
import { allCommands } from './index.js';

const EXPECTED_COMMANDS = [
	'parse-prd',
	'parse-prd-with-research',
	'analyze-complexity',
	'complexity-report',
	'expand-task',
	'expand-all-tasks',
	'add-task',
	'add-subtask',
	'remove-task',
	'remove-subtask',
	'remove-subtasks',
	'remove-all-subtasks',
	'convert-task-to-subtask',
	'add-dependency',
	'remove-dependency',
	'fix-dependencies',
	'validate-dependencies',
	'setup-models',
	'view-models',
	'install-taskgraph',
	'quick-install-taskgraph',
	'to-review',
	'to-deferred',
	'to-cancelled',
	'init-project',
	'init-project-quick',
	'show-task',
	'graph',
	'why',
	'list-tasks',
	'list-tasks-with-subtasks',
	'list-tasks-by-status',
	'project-status',
	'next-task',
	'help',
	'to-done',
	'to-pending',
	'to-in-progress',
	'update-task',
	'update-single-task',
	'update-tasks-from-id',
	'tm-main',
	'smart-workflow',
	'learn',
	'command-pipeline',
	'auto-implement-tasks',
	'analyze-project',
	'sync-readme'
];

describe('allCommands', () => {
	it('contains every local task command', () => {
		const names = allCommands.map((cmd) => cmd.metadata.name);

		for (const expected of EXPECTED_COMMANDS) {
			expect(names).toContain(expected);
		}
		expect(names).toHaveLength(EXPECTED_COMMANDS.length);
	});

	it('has unique command names', () => {
		const names = allCommands.map((cmd) => cmd.metadata.name);

		expect(new Set(names).size).toBe(names.length);
	});

	it('has no Hamster command', () => {
		const names = allCommands.map((cmd) => cmd.metadata.name);

		expect(names).not.toContain('goham');
		for (const cmd of allCommands) {
			expect(cmd.content).not.toMatch(/hamster/i);
			expect(cmd.metadata.description).not.toMatch(/hamster/i);
		}
	});

	it('does not tag commands with an operating mode', () => {
		for (const cmd of allCommands) {
			expect('mode' in cmd.metadata).toBe(false);
		}
	});

	it('does not export the operating-mode helpers', () => {
		expect('filterCommandsByMode' in commandModule).toBe(false);
		expect('soloCommands' in commandModule).toBe(false);
		expect('teamCommands' in commandModule).toBe(false);
		expect('commonCommands' in commandModule).toBe(false);
		expect('goham' in commandModule).toBe(false);
	});
});
