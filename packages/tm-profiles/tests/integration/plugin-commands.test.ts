import { readFileSync, readdirSync } from 'node:fs';
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
	'to-review',
	'to-deferred',
	'to-cancelled',
	'init-project',
	'show-task',
	'graph',
	'list-tasks',
	'project-status',
	'next-task',
	'help',
	'to-done',
	'to-pending',
	'to-in-progress',
	'update-task',
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

describe('merged plugin commands', () => {
	const body = (name: string) =>
		readFileSync(join(commandsDir, `${name}.md`), 'utf-8');

	it('list-tasks covers status and subtask listing', () => {
		expect(body('list-tasks')).toContain('taskgraph list --status=');
		expect(body('list-tasks')).toContain('taskgraph list --with-subtasks');
	});

	it('init-project covers the quick form', () => {
		expect(body('init-project')).toContain('taskgraph init -y');
		expect(body('init-project')).toContain('--quick');
	});

	it('install-taskgraph covers the quick form', () => {
		expect(body('install-taskgraph')).toContain('--quick');
		expect(body('install-taskgraph')).toContain(
			'taskgraph --version 2>/dev/null || npm install -g taskgraph-ai'
		);
	});

	it('list-tasks passes blocked as a status, apart from unmet dependencies', () => {
		expect(body('list-tasks')).toContain('taskgraph list --status=blocked');
		expect(body('list-tasks')).toContain('unmet dependencies');
	});

	it('update-task points bulk and status changes at the right commands', () => {
		expect(body('update-task')).toContain('/taskgraph:update-tasks-from-id');
		expect(body('update-task')).toContain('/taskgraph:set-status');
	});

	it.each([
		['list-tasks', '[status] [--subtasks]'],
		['init-project', '[--quick] [<prd-file>]'],
		['install-taskgraph', '[--quick]'],
		['update-task', '<task ID> <changes>']
	])('%s declares its argument hint', (name, hint) => {
		expect(body(name)).toContain(`argument-hint: "${hint}"`);
		expect(body(name)).toContain('$ARGUMENTS');
	});

	it('update-task runs the single-task CLI command', () => {
		expect(body('update-task')).toContain(
			'taskgraph update-task --id=<id> --prompt='
		);
	});
});
