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
	'why',
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

describe('taskgraph flags used in command bodies', () => {
	const stripComments = (source: string) =>
		source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

	// The long flags declared with .option('-x, --name <value>', ...)
	const longFlags = (source: string): string[] =>
		[...source.matchAll(/\.option\(\s*'([^']*)'/g)].flatMap((match) =>
			[...match[1].matchAll(/--([a-z][a-z-]*)/g)].map((flag) => flag[1])
		);

	const legacySource = stripComments(
		readFileSync(join(repoRoot, 'scripts/modules/commands.js'), 'utf-8')
	);
	const registrySource = stripComments(
		readFileSync(join(repoRoot, 'apps/cli/src/command-registry.ts'), 'utf-8')
	);

	const flagsByCommand = new Map<string, Set<string>>();

	// Legacy commands: the options between one .command('name') and the next
	const legacyStarts = [...legacySource.matchAll(/\.command\('([a-z-]+)'/g)];
	legacyStarts.forEach((match, index) => {
		const block = legacySource.slice(
			match.index,
			legacyStarts[index + 1]?.index ?? legacySource.length
		);
		flagsByCommand.set(match[1], new Set(longFlags(block)));
	});

	// Registry commands: the options in the class file each entry points at
	const classFiles = new Map(
		[
			...registrySource.matchAll(
				/import \{ (\w+) \} from '\.\/(commands\/[^']+)\.js'/g
			)
		].map((match) => [match[1], `apps/cli/src/${match[2]}.ts`])
	);
	for (const match of registrySource.matchAll(
		/name: '([a-z-]+)',[\s\S]*?commandClass: (\w+)/g
	)) {
		const file = classFiles.get(match[2]);
		if (!file) continue;
		flagsByCommand.set(
			match[1],
			new Set(
				longFlags(stripComments(readFileSync(join(repoRoot, file), 'utf-8')))
			)
		);
	}

	// `taskgraph <name> ...` lines inside fenced code blocks, with their flags
	const invocations = (markdown: string) => {
		const calls: Array<{ command: string; flags: string[] }> = [];
		let inFence = false;
		for (const line of markdown.split('\n')) {
			if (line.trim().startsWith('```')) {
				inFence = !inFence;
				continue;
			}
			const match =
				inFence && line.match(/^\s*(?:\$ )?taskgraph ([a-z][a-z-]*)(.*)$/);
			if (!match) continue;
			const args = match[2].split('#')[0].replace(/"[^"]*"/g, '""');
			calls.push({
				command: match[1],
				flags: [...args.matchAll(/(?:^|\s)--([a-z][a-z-]*)/g)].map(
					(flag) => flag[1]
				)
			});
		}
		return calls;
	};

	const unknownFlags = (markdown: string): string[] =>
		invocations(markdown).flatMap(({ command, flags }) => {
			const known = flagsByCommand.get(command);
			return flags
				.filter(
					(flag) =>
						flag !== 'help' &&
						!known?.has(flag) &&
						!known?.has(`no-${flag}`) &&
						!(flag.startsWith('no-') && known?.has(flag.slice(3)))
				)
				.map((flag) => `${command} --${flag}`);
		});

	it('reads the flags each CLI command declares', () => {
		for (const flag of ['id', 'status', 'check', 'force']) {
			expect(flagsByCommand.get('set-status')?.has(flag)).toBe(true);
		}
		expect(flagsByCommand.get('show')?.has('json')).toBe(true);
		expect(flagsByCommand.get('update-task')?.has('append')).toBe(true);
		expect(flagsByCommand.get('update-subtask')?.has('prompt')).toBe(true);
		expect(flagsByCommand.get('update-subtask')?.has('append')).toBe(false);
	});

	it('flags a flag the command does not declare', () => {
		expect(
			unknownFlags(
				'```bash\ntaskgraph update-task --id=3 --checked --prompt="a --b"\n```'
			)
		).toEqual(['update-task --checked']);
	});

	it.each(readdirSync(commandsDir).filter((file) => file.endsWith('.md')))(
		'%s passes only flags its commands declare',
		(file) => {
			expect(
				unknownFlags(readFileSync(join(commandsDir, file), 'utf-8'))
			).toEqual([]);
		}
	);

	it('to-done passes only flags its commands declare', () => {
		const body = readFileSync(join(commandsDir, 'to-done.md'), 'utf-8');

		expect(invocations(body).map((call) => call.command)).toEqual(
			expect.arrayContaining([
				'show',
				'set-status',
				'update-subtask',
				'update-task',
				'next'
			])
		);
		expect(unknownFlags(body)).toEqual([]);
	});
});

describe('to-done', () => {
	const body = readFileSync(join(commandsDir, 'to-done.md'), 'utf-8');

	it('has the task-checker agent give a verdict on each numbered item', () => {
		expect(body).toContain('`taskgraph:task-checker`');
		expect(body).toContain('`met`, `not met` or `unclear`');
	});

	it('ticks confirmed items with set-status --check', () => {
		expect(body).toContain('taskgraph set-status --id=<id> --check <n>,<n>');
	});

	it('saves the summary before marking the task done', () => {
		expect(
			body.indexOf('taskgraph update-task --id=<id> --append')
		).toBeLessThan(
			body.indexOf('taskgraph set-status --id=<id> --status=done')
		);
	});

	it('never runs --force on its own', () => {
		expect(body).not.toMatch(/^\s*taskgraph .*--force/m);
		expect(body).toContain('only when the user says so');
	});
});

describe('task-checker agent', () => {
	const agent = readFileSync(
		join(repoRoot, 'packages/claude-code-plugin/agents/task-checker.md'),
		'utf-8'
	);

	it('returns a verdict with evidence for each checklist item', () => {
		expect(agent).toContain('verdict: met | not met | unclear');
		expect(agent).toContain('evidence:');
	});

	it('leaves task state to the caller', () => {
		expect(agent).toContain('NEVER change task state');
	});
});
