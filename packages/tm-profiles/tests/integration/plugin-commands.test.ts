import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const commandsDir = join(repoRoot, 'packages/claude-code-plugin/commands');

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
	'clear-subtasks',
	'convert-task-to-subtask',
	'add-dependency',
	'remove-dependency',
	'fix-dependencies',
	'validate-dependencies',
	'setup-models',
	'view-models',
	'install-taskgraph',
	'init-project',
	'show-task',
	'graph',
	'list-tasks',
	'project-status',
	'next-task',
	'help',
	'set-status',
	'to-done',
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

describe('status and subtask commands', () => {
	const body = (name: string) =>
		readFileSync(join(commandsDir, `${name}.md`), 'utf-8');

	it('set-status takes a task id and a status', () => {
		expect(body('set-status')).toContain(
			'taskgraph set-status --id=<id> --status=<status>'
		);
	});

	it('set-status lists every status the CLI accepts', () => {
		const source = readFileSync(
			join(repoRoot, 'apps/cli/src/commands/set-status.command.ts'),
			'utf-8'
		);
		const list = source.match(
			/VALID_TASK_STATUSES: TaskStatus\[\] = \[([^\]]*)\]/
		);
		const statuses = [...(list?.[1] ?? '').matchAll(/'([a-z-]+)'/g)].map(
			(match) => match[1]
		);

		expect(statuses.length).toBeGreaterThan(5);
		for (const status of statuses) {
			expect(body('set-status')).toContain(`\`${status}\``);
		}
	});

	it('remove-subtask maps to the single-subtask CLI command', () => {
		expect(body('remove-subtask')).toContain('taskgraph remove-subtask --id=');
		expect(body('remove-subtask')).not.toContain('taskgraph clear-subtasks');
		expect(body('remove-subtask')).not.toContain('--all');
	});

	it('clear-subtasks requires the typed confirmation for --all', () => {
		expect(body('clear-subtasks')).toMatch(
			/taskgraph clear-subtasks --all[\s\S]*only after the user types `CLEAR ALL SUBTASKS`/
		);
	});

	it('remove-subtask declares its argument hint', () => {
		expect(body('remove-subtask')).toContain(
			'argument-hint: "<id> [--convert]"'
		);
	});

	it('clear-subtasks maps to the clear-subtasks CLI command, one task or all', () => {
		expect(body('clear-subtasks')).toContain('taskgraph clear-subtasks --id=');
		expect(body('clear-subtasks')).toContain('taskgraph clear-subtasks --all');
	});
});

describe('taskgraph commands used in command bodies', () => {
	const cliSources = [
		'scripts/modules/commands.js',
		'apps/cli/src/command-registry.ts'
	].map((file) =>
		readFileSync(join(repoRoot, file), 'utf-8')
			.replace(/\/\*[\s\S]*?\*\//g, '')
			.replace(/^\s*\/\/.*$/gm, '')
	);

	const realCommands = new Set(
		[
			...cliSources[0].matchAll(/\.command\('([a-z-]+)'/g),
			...cliSources[1].matchAll(/^\s+name: '([a-z-]+)'/gm)
		].map((match) => match[1])
	);

	// `taskgraph <name>` at the start of a line inside a fenced code block
	const invokedCommands = (markdown: string): string[] => {
		const names: string[] = [];
		let inFence = false;
		for (const line of markdown.split('\n')) {
			if (line.trim().startsWith('```')) {
				inFence = !inFence;
				continue;
			}
			const match =
				inFence && line.match(/^\s*(?:\$ )?taskgraph ([a-z][a-z-]*)/);
			if (match) names.push(match[1]);
		}
		return names;
	};

	it('finds the CLI commands to compare against', () => {
		expect(realCommands.has('set-status')).toBe(true);
		expect(realCommands.has('clear-subtasks')).toBe(true);
	});

	it.each(readdirSync(commandsDir).filter((file) => file.endsWith('.md')))(
		'%s only runs real taskgraph commands',
		(file) => {
			const unknown = invokedCommands(
				readFileSync(join(commandsDir, file), 'utf-8')
			).filter((name) => !realCommands.has(name));

			expect(unknown).toEqual([]);
		}
	);
});
