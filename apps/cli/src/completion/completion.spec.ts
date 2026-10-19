/**
 * Shell completion: spec building, the engine (run for real with node),
 * and the generated scripts (bash run for real; zsh and fish syntax-checked
 * when installed).
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Argument, Command } from 'commander';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildEngineProgram } from './engine.js';
import { detectShell, renderCompletionScript } from './scripts.js';
import { buildCompletionSpec } from './spec.js';

function makeProgram(): Command {
	const program = new Command('taskgraph').version('1.2.3');
	program
		.command('show')
		.description('Show a task')
		.argument('[id]')
		.option('-i, --id <id>', 'Task ID')
		.option('-f, --format <format>', 'Output format')
		.option('-t, --tag <tag>', 'Tag');
	program
		.command('set-status')
		.alias('status')
		.argument('[id]')
		.argument('[status]')
		.option('-i, --id <ids>', 'Task IDs')
		.option('-s, --status <status>', 'New status')
		.option('--silent', "Don't print anything");
	program.command('parse-prd').argument('[file]').option('--tag <tag>', 'Tag');
	program.command('graph').option('-p, --project <path>', 'Project root');
	const tags = program.command('tags').description('Manage tags');
	tags.command('use').argument('<name>');
	tags.command('add').argument('<name>');
	program
		.command('completion')
		.addArgument(new Argument('[shell]').choices(['bash', 'zsh', 'fish']));
	program.command('secret', { hidden: true });
	return program;
}

const spec = buildCompletionSpec(makeProgram());
const program = buildEngineProgram(spec);

let project: string;

beforeAll(() => {
	project = mkdtempSync(join(tmpdir(), 'tg-completion-'));
	mkdirSync(join(project, '.taskgraph', 'tasks'), { recursive: true });
	mkdirSync(join(project, 'docs'));
	writeFileSync(join(project, 'docs', 'prd.md'), '# PRD');
	writeFileSync(
		join(project, '.taskgraph', 'tasks', 'tasks.json'),
		JSON.stringify({
			master: {
				tasks: [
					{ id: 1, title: 'Scaffold', status: 'done', subtasks: [] },
					{
						id: 2,
						title: 'Resolver\nwith cycles',
						status: 'pending',
						subtasks: [
							{ id: 1, title: 'Sort', status: 'done' },
							{ id: 2, title: 'Report', status: 'pending' }
						]
					},
					{ id: 10, title: 'Docs', status: 'pending' }
				]
			},
			'feature-x': { tasks: [{ id: 7, title: 'Only in X', status: 'pending' }] }
		})
	);
	writeFileSync(
		join(project, '.taskgraph', 'state.json'),
		JSON.stringify({ currentTag: 'master' })
	);
});

afterAll(() => {
	rmSync(project, { recursive: true, force: true });
});

interface Result {
	mode: string;
	optPrefix: string;
	listPrefix: string;
	label: string;
	values: string[];
	descriptions: string[];
}

function complete(words: string[], shell = 'zsh', cwd = project): Result {
	const out = execFileSync(
		process.execPath,
		['-e', program, '--', shell, ...words],
		{ cwd, encoding: 'utf8', env: { ...process.env, TASKGRAPH_TAG: '' } }
	);
	const lines = out.split('\n').slice(0, -1);
	const [mode, optPrefix, listPrefix, label] = lines
		.slice(0, 4)
		.map((l) => l.slice(1));
	const rest = lines.slice(4);
	return {
		mode,
		optPrefix,
		listPrefix,
		label,
		values: rest.map((l) => l.split('\t')[0]),
		descriptions: rest.map((l) => l.split('\t')[1] ?? '')
	};
}

describe('buildCompletionSpec', () => {
	it('lists visible commands with aliases and leaves out hidden ones', () => {
		const names = spec.commands.map((c) => c.name);
		expect(names).toContain('set-status');
		expect(names).not.toContain('secret');
		expect(spec.commands.find((c) => c.name === 'set-status')?.aliases).toEqual(
			['status']
		);
	});

	it('infers what each value completes with', () => {
		const show = spec.commands.find((c) => c.name === 'show');
		const setStatus = spec.commands.find((c) => c.name === 'set-status');
		const kind = (cmd: typeof show, long: string) =>
			cmd?.options.find((o) => o.long === long)?.value;
		expect(kind(show, '--id')).toEqual({ kind: 'ids' });
		expect(kind(show, '--format')?.choices).toEqual(['text', 'json']);
		expect(kind(setStatus, '--status')?.choices).toContain('in-progress');
		expect(kind(setStatus, '--silent')).toBeUndefined();
		expect(setStatus?.args.map((a) => a.value.kind)).toEqual([
			'ids',
			'choices'
		]);
	});

	it('completes existing tags, except where a new tag is named', () => {
		const tags = spec.commands.find((c) => c.name === 'tags');
		const arg = (name: string) =>
			tags?.commands.find((c) => c.name === name)?.args[0].value.kind;
		expect(arg('use')).toBe('tags');
		expect(arg('add')).toBe('none');
	});

	it('adds --help to every command', () => {
		expect(spec.options.some((o) => o.long === '--help')).toBe(true);
		expect(
			spec.commands.every((c) => c.options.some((o) => o.long === '--help'))
		).toBe(true);
	});
});

describe('completion engine', () => {
	it('completes commands with descriptions', () => {
		const result = complete(['s']);
		expect(result.label).toBe('commands');
		expect(result.values).toEqual(['show', 'set-status']);
		expect(result.descriptions[0]).toBe('Show a task');
	});

	it('follows aliases into subcommands', () => {
		expect(complete(['status', '--s']).values).toEqual([
			'--status',
			'--silent'
		]);
	});

	it('completes task and subtask IDs with title and status', () => {
		const result = complete(['show', '']);
		expect(result.values).toEqual(['1', '2', '2.1', '2.2', '10']);
		expect(result.descriptions[1]).toBe('Resolver with cycles (pending)');
		expect(complete(['show', '2.']).values).toEqual(['2.1', '2.2']);
	});

	it('completes the item after the last comma and skips IDs already listed', () => {
		const result = complete(['set-status', '--id', '1,2.1,']);
		expect(result.listPrefix).toBe('1,2.1,');
		expect(result.values).toEqual(['2', '2.2', '10']);
	});

	it('completes --flag=value forms and reports the flag as a prefix', () => {
		const result = complete(['set-status', '--status=in']);
		expect(result.optPrefix).toBe('--status=');
		expect(result.values).toEqual(['in-progress']);
	});

	it('rejoins the words bash splits at "="', () => {
		expect(complete(['set-status', '--id', '=', '2.'], 'bash').values).toEqual([
			'2.1',
			'2.2'
		]);
		expect(complete(['set-status', '--id', '='], 'bash').values).toHaveLength(
			5
		);
	});

	it('completes positional arguments in order', () => {
		expect(complete(['set-status', '2', 'd']).values).toEqual([
			'done',
			'deferred'
		]);
	});

	it('reads tags from tasks.json and IDs from the tag given with --tag', () => {
		expect(complete(['tags', 'use', '']).values).toEqual([
			'master',
			'feature-x'
		]);
		expect(complete(['show', '--tag', 'feature-x', '--id', '']).values).toEqual(
			['7']
		);
	});

	it('hands paths back to the shell', () => {
		expect(complete(['parse-prd', 'do']).mode).toBe('files');
		const dirs = complete(['graph', '--project=']);
		expect(dirs.mode).toBe('dirs');
		expect(dirs.optPrefix).toBe('--project=');
	});

	it('finds the project from a subdirectory', () => {
		expect(
			complete(['show', '1'], 'zsh', join(project, 'docs')).values
		).toEqual(['1', '10']);
	});

	it('suggests nothing for IDs outside a project', () => {
		const outside = mkdtempSync(join(tmpdir(), 'tg-none-'));
		try {
			expect(complete(['show', ''], 'zsh', outside).values).toEqual([]);
		} finally {
			rmSync(outside, { recursive: true, force: true });
		}
	});

	it('offers flags when a command takes no arguments', () => {
		expect(complete(['graph', '']).values).toEqual(['--project', '--help']);
	});

	it('leaves out flags already given', () => {
		expect(complete(['show', '--format', 'json', '--']).values).toEqual([
			'--id',
			'--tag',
			'--help'
		]);
	});

	it('completes fixed choices for arguments', () => {
		expect(complete(['completion', '']).values).toEqual([
			'bash',
			'zsh',
			'fish'
		]);
	});
});

describe('renderCompletionScript', () => {
	const tricky = buildCompletionSpec(
		new Command('taskgraph').option('--x', "it's a back\\slash `tick`")
	);

	it.each(['bash', 'zsh', 'fish'] as const)(
		'keeps quotes and backslashes in descriptions intact in %s',
		(shell) => {
			const script = renderCompletionScript(shell, tricky, '1.2.3');
			expect(script).toContain(
				`TaskGraph completion for ${shell} (taskgraph 1.2.3)`
			);
			const dir = mkdtempSync(join(tmpdir(), 'tg-script-'));
			try {
				const file = join(dir, `taskgraph.${shell}`);
				writeFileSync(file, script);
				const run = spawnSync(
					shell,
					['-c', `source ${file} && printf %s "$__taskgraph_program"`],
					{ encoding: 'utf8', env: { ...process.env, HOME: dir } }
				);
				if (run.error) return; // shell not installed here
				expect(run.status, run.stderr).toBe(0);
				const json = run.stdout.split(';\n')[0].slice('var SPEC = '.length);
				const evaluated = JSON.parse(json);
				expect(evaluated.options[0].description).toBe(
					"it's a back\\slash `tick`"
				);
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		}
	);

	it('starts the zsh script with #compdef so it can be autoloaded', () => {
		expect(
			renderCompletionScript('zsh', spec).startsWith('#compdef taskgraph\n')
		).toBe(true);
	});

	it('completes in a real bash session', () => {
		const script = renderCompletionScript('bash', spec);
		const run = `${script}
COMP_WORDS=(taskgraph set-status --id = 2.); COMP_CWORD=4; _taskgraph; echo "\${COMPREPLY[*]}"
COMP_WORDS=(taskgraph show 1,); COMP_CWORD=2; _taskgraph; echo "\${COMPREPLY[*]}"`;
		const out = execFileSync('bash', ['-c', run], {
			cwd: project,
			encoding: 'utf8',
			env: { ...process.env, TASKGRAPH_TAG: '' }
		});
		expect(out.trim().split('\n')).toEqual(['2.1 2.2', '1,2 1,2.1 1,2.2 1,10']);
	});
});

describe('detectShell', () => {
	it('reads the shell name from $SHELL', () => {
		expect(detectShell('/bin/zsh')).toBe('zsh');
		expect(detectShell('/usr/local/bin/fish')).toBe('fish');
		expect(detectShell('/bin/tcsh')).toBeUndefined();
		expect(detectShell('')).toBeUndefined();
	});
});
