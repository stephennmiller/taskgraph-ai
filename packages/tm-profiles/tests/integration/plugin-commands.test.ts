import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	cliSurface,
	codeLines,
	invocations,
	unknownFlags as unknownFlagsIn,
	unknownStandaloneFlags as unknownStandaloneFlagsIn
} from './cli-surface.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const commandsDir = join(repoRoot, 'packages/claude-code-plugin/commands');

// The CLI commands and long flags this checkout declares
const flagsByCommand = cliSurface((file) =>
	readFileSync(join(repoRoot, file), 'utf-8')
);

/** A plugin command's markdown, by name */
const body = (name: string) =>
	readFileSync(join(commandsDir, `${name}.md`), 'utf-8');

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
	it('finds the CLI commands to compare against', () => {
		expect(flagsByCommand.has('set-status')).toBe(true);
		expect(flagsByCommand.has('clear-subtasks')).toBe(true);
		// Added inline in apps/cli/src/program.ts, not through the registry
		expect(flagsByCommand.has('help')).toBe(true);
		expect(flagsByCommand.get('status')).toBe(flagsByCommand.get('set-status'));
	});

	it.each(readdirSync(commandsDir).filter((file) => file.endsWith('.md')))(
		'%s only runs real taskgraph commands',
		(file) => {
			const unknown = invocations(
				codeLines(readFileSync(join(commandsDir, file), 'utf-8'))
			)
				.map((call) => call.command)
				.filter((name) => !flagsByCommand.has(name));

			expect(unknown).toEqual([]);
		}
	);
});

describe('taskgraph flags used in command bodies', () => {
	const unknownFlags = (markdown: string) =>
		unknownFlagsIn(invocations(codeLines(markdown)), flagsByCommand);

	it('reads the flags each CLI command declares', () => {
		for (const flag of ['id', 'status', 'check', 'force']) {
			expect(flagsByCommand.get('set-status')?.has(flag)).toBe(true);
		}
		expect(flagsByCommand.get('show')?.has('json')).toBe(true);
		expect(flagsByCommand.get('next')?.has('json')).toBe(true);
		expect(flagsByCommand.get('update-task')?.has('append')).toBe(true);
		expect(flagsByCommand.get('update-subtask')?.has('prompt')).toBe(true);
		expect(flagsByCommand.get('update-subtask')?.has('append')).toBe(false);
		// Imported together with three other classes from one file
		expect(flagsByCommand.get('add-dependency')?.has('depends-on')).toBe(true);
	});

	it('flags a flag the command does not declare', () => {
		expect(
			unknownFlags(
				'```bash\ntaskgraph update-task --id=3 --checked --prompt="a --b"\n```'
			)
		).toEqual(['update-task --checked']);
	});

	it('ignores flags inside single-quoted text', () => {
		expect(
			unknownFlags(
				"```bash\ntaskgraph update-task --id=3 --prompt='it'\\''s # --b' --checked\n```"
			)
		).toEqual(['update-task --checked']);
	});

	it('reads hidden flags declared with new Option', () => {
		expect(flagsByCommand.get('models')?.has('claude-code')).toBe(true);
	});

	it.each(readdirSync(commandsDir).filter((file) => file.endsWith('.md')))(
		'%s passes only flags its commands declare',
		(file) => {
			expect(
				unknownFlags(readFileSync(join(commandsDir, file), 'utf-8'))
			).toEqual([]);
		}
	);

	const unknownStandaloneFlags = (markdown: string) =>
		unknownStandaloneFlagsIn(markdown, flagsByCommand);

	it('flags a standalone flag none of the body commands declare', () => {
		expect(
			unknownStandaloneFlags(
				'Run `taskgraph expand --id=3`, adding `--research` or `--deep`.'
			)
		).toEqual(['--deep']);
	});

	it.each(readdirSync(commandsDir).filter((file) => file.endsWith('.md')))(
		'%s names only flags its commands declare',
		(file) => {
			expect(
				unknownStandaloneFlags(readFileSync(join(commandsDir, file), 'utf-8'))
			).toEqual([]);
		}
	);

	it('to-done passes only flags its commands declare', () => {
		const body = readFileSync(join(commandsDir, 'to-done.md'), 'utf-8');

		expect(invocations(codeLines(body)).map((call) => call.command)).toEqual(
			expect.arrayContaining(['show', 'set-status', 'note', 'next'])
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

	it('saves the summary with taskgraph note before marking the task done', () => {
		const note = body.indexOf("taskgraph note <id> 'Close summary");

		expect(note).toBeGreaterThan(-1);
		expect(note).toBeLessThan(
			body.indexOf('taskgraph set-status --id=<id> --status=done')
		);
		// note saves the text as written; the AI rewrite commands aren't needed
		expect(body).not.toMatch(/^\s*taskgraph update-(sub)?task/m);
	});

	it('passes the summary in single quotes, so the shell runs nothing in it', () => {
		const notes = [...body.matchAll(/^\s*taskgraph note <id> (.)/gm)];

		expect(notes.map((match) => match[1])).toEqual(["'"]);
		expect(body).toContain("write any `'` inside it as `'\\''`");
	});

	it('uses the ID only when it is a task number', () => {
		expect(body).toContain('only when it is digits and dots');
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

describe('parse-prd', () => {
	const body = readFileSync(join(commandsDir, 'parse-prd.md'), 'utf-8');

	it('gets the questions as JSON before generating anything', () => {
		expect(body).toContain("taskgraph parse-prd '<prd-file>' --clarify --json");
		expect(body.indexOf('--clarify --json')).toBeLessThan(
			body.indexOf('--answers ')
		);
	});

	it('passes the answers in a file written with the Write tool, never through the shell', () => {
		// An answer with a line that is exactly the heredoc delimiter would end
		// a heredoc early and run the rest of the answer as shell commands
		const shellBlocks = [...body.matchAll(/```bash\n([\s\S]*?)```/g)].map(
			(match) => match[1]
		);

		expect(body).toContain(
			'to `.taskgraph/clarify-answers.json` with the Write tool'
		);
		expect(body).toMatch(
			/^taskgraph parse-prd '<prd-file>' --answers \.taskgraph\/clarify-answers\.json$/m
		);
		expect(body).toMatch(/^rm \.taskgraph\/clarify-answers\.json$/m);
		for (const block of shellBlocks) {
			expect(block).not.toMatch(/<<|--answers -|echo/);
		}
	});

	it('single-quotes the PRD path in every call', () => {
		const calls = [...body.matchAll(/^taskgraph parse-prd (\S+)/gm)];

		expect(calls.length).toBeGreaterThan(1);
		for (const call of calls) expect(call[1]).toBe("'<prd-file>'");
		expect(body).toContain("write any `'` in it as `'\\''`");
	});
});

/**
 * Command bodies run the CLI and show what it prints (#244). The prompts they
 * replaced asked Claude for velocity, sprint progress and time estimates,
 * which TaskGraph doesn't store, so Claude made them up.
 */
describe('command bodies run the CLI instead of asking for untracked data', () => {
	const files = readdirSync(commandsDir).filter((file) => file.endsWith('.md'));
	const names = files.map((file) => file.slice(0, -3));

	// The CLI command each slash command is named after, and must run
	const RUNS: Record<string, string> = {
		'add-dependency': 'add-dependency',
		'add-subtask': 'add-subtask',
		'add-task': 'add-task',
		'analyze-complexity': 'analyze-complexity',
		'clear-subtasks': 'clear-subtasks',
		'complexity-report': 'complexity-report',
		'convert-task-to-subtask': 'add-subtask',
		'expand-all-tasks': 'expand',
		'expand-task': 'expand',
		'fix-dependencies': 'fix-dependencies',
		graph: 'graph',
		'init-project': 'init',
		'install-taskgraph': '--version',
		'list-tasks': 'list',
		'next-task': 'next',
		'parse-prd': 'parse-prd',
		'parse-prd-with-research': 'parse-prd',
		'project-status': 'prime',
		'remove-dependency': 'remove-dependency',
		'remove-subtask': 'remove-subtask',
		'remove-task': 'remove-task',
		'set-status': 'set-status',
		'setup-models': 'models',
		'show-task': 'show',
		'sync-readme': 'sync-readme',
		'to-done': 'set-status',
		'to-in-progress': 'set-status',
		'update-task': 'update-task',
		'update-tasks-from-id': 'update',
		'validate-dependencies': 'validate-dependencies',
		'view-models': 'models',
		why: 'why'
	};
	// Lists of the slash commands, not tied to one CLI command
	const REFERENCES = ['help', 'tm-main'];

	it('knows which CLI command every slash command runs', () => {
		const unmapped = names.filter(
			(name) => !(name in RUNS) && !REFERENCES.includes(name)
		);

		expect(unmapped).toEqual([]);
	});

	it.each(Object.entries(RUNS))('%s runs `taskgraph %s`', (name, command) => {
		const runs = new RegExp(`^\\s*taskgraph ${command}(\\s|$)`);

		expect(codeLines(body(name)).some((line) => runs.test(line))).toBe(true);
	});

	it.each(names)('%s asks for no metric TaskGraph does not store', (name) => {
		expect(
			body(name).match(/velocity|sprint|burndown|estimat|timeline/gi)
		).toBeNull();
	});

	it('help lists every slash command', () => {
		const listed = new Set(
			[...body('help').matchAll(/^ {2}\/taskgraph:([a-z-]+)/gm)].map(
				(match) => match[1]
			)
		);

		expect(names.filter((name) => !listed.has(name))).toEqual(REFERENCES);
	});

	it('tm-main shows the same list as help', () => {
		const list = (name: string) => body(name).match(/```\n[\s\S]*?```/)?.[0];

		expect(list('tm-main')).toBeDefined();
		expect(list('tm-main')).toBe(list('help'));
	});
});
