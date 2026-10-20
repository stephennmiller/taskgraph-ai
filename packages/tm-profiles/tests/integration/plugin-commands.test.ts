import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const commandsDir = join(
	dirname(fileURLToPath(import.meta.url)),
	'../../../claude-code-plugin/commands'
);

// The plugin is the only slash-command channel (#169): these files are canonical
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

describe('plugin command files', () => {
	const names = readdirSync(commandsDir)
		.filter((file) => file.endsWith('.md'))
		.map((file) => file.replace(/\.md$/, ''));

	it('are exactly the expected command set', () => {
		expect([...names].sort()).toEqual([...EXPECTED_COMMANDS].sort());
	});

	it('contain nothing but command markdown files', () => {
		expect(readdirSync(commandsDir)).toHaveLength(names.length);
	});
});
