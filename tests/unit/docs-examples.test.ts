/**
 * Runs the commands the CLI reference shows. Every line in a ```bash block
 * of apps/docs/capabilities/cli-*.mdx runs with the built CLI against a
 * copy of one fixture project and must exit 0, so an example the CLI
 * refuses fails here instead of reaching a reader (#1111, #1122).
 *
 * A line is left out only when it runs the AI (by command name or
 * `--prompt`/`--research`) or is listed in SKIPPED with its reason. An
 * example that needs a task, tag or file gets it from the fixture.
 *
 * Needs dist/taskgraph.js (`npm run build`; CI's test job downloads it).
 * No network, GitHub sign-in or Claude: the CLI runs with an environment
 * built here, a home folder in the fixture, and stand-ins first on PATH for
 * the programs it could start (OUTSIDE_PROGRAMS). A stand-in that is
 * called fails the run. The "current version" of json-output.mdx is pinned
 * in taskgraph-claude-md-drift.test.ts.
 */

import {
	type ExecFileException,
	execFile,
	execFileSync
} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bashExamples } from './doc-code.js';

const rootDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../..'
);
const cli = path.join(rootDir, 'dist', 'taskgraph.js');
const docsDir = path.join(rootDir, 'apps/docs/capabilities');

/** Commands that call the AI whatever their flags */
const AI_COMMANDS = new Set([
	'parse-prd',
	'expand',
	'research',
	'loop',
	'go',
	'analyze-complexity',
	'scope'
]);

/** Whether a line would call the AI: never run, it bills the user's Claude */
const callsAi = (line: string) =>
	AI_COMMANDS.has(line.split(/\s+/)[1]) || /--(prompt|research)\b/.test(line);

/**
 * Programs the CLI could start that bill, sign in or reach the network. Each
 * gets a stand-in that records the call and exits 1, so a line that slips
 * past callsAi fails here instead of running the machine's own.
 */
const OUTSIDE_PROGRAMS = ['claude', 'gh', 'npm', 'npx', 'docker'];

/** `gh api user` answers a login for `list --mine`; any other call is recorded */
const standIn = (name: string, calls: string) =>
	`#!/bin/sh
${name === 'gh' ? 'if [ "$1 $2" = "api user" ]; then echo octocat; exit 0; fi\n' : ''}echo "${name} $*" >> '${calls}'
exit 1
`;

/** Example lines that are not run, each with why */
const SKIPPED: Record<string, string> = {
	'taskgraph init':
		'asks on a terminal whether to store tasks in Git; `init --yes` builds the fixture',
	'taskgraph init --no-claude':
		'asks on a terminal whether to store tasks in Git',
	'taskgraph init --mcp': 'asks on a terminal whether to store tasks in Git',
	'taskgraph init --from-taskmaster':
		'asks on a terminal whether to store tasks in Git',
	'taskgraph doctor':
		"exits 1 for what this machine lacks (Claude Code, the plugin), and starts the machine's claude",
	'taskgraph doctor --json': 'as doctor',
	'taskgraph doctor --fix': 'as doctor',
	'taskgraph upgrade': 'downloads and installs a release from the network',
	'taskgraph models --setup': 'asks its questions on a terminal',
	'taskgraph list --watch': 'runs until Ctrl-C',
	'taskgraph list -w': 'runs until Ctrl-C',
	'taskgraph list -w -c': 'runs until Ctrl-C'
};

/**
 * What a `<placeholder>` stands for in the fixture: the first value for its
 * first use in a line, the next for its second, the last for any after.
 */
const PLACEHOLDERS: Record<string, string[]> = {
	// Task 4 depends on task 8
	'<id>': ['4', '8'],
	'<status>': ['in-progress'],
	'<tag-name>': ['feature'],
	'<source-tag>': ['feature'],
	'<old-name>': ['feature'],
	'<new-tag>': ['copied'],
	'<target-tag>': ['copied'],
	'<new-name>': ['renamed']
};

/** Lines whose placeholder means something the table above can't say */
const REWRITTEN: Record<string, string> = {
	// A tag that doesn't exist yet
	'taskgraph tags add <tag-name>': 'taskgraph tags add fresh',
	'taskgraph tags add <tag-name> --description="Feature development tasks"':
		'taskgraph tags add fresh --description="Feature development tasks"',
	// Named after the fixture's branch
	'taskgraph tags add <tag-name> --from-branch':
		'taskgraph tags add --from-branch',
	// To a free ID
	'taskgraph move --from=<id> --to=<id>': 'taskgraph move --from=4 --to=9'
};

/** Split a command line into arguments, honouring single and double quotes */
function words(line: string): string[] {
	return [...line.matchAll(/(?:[^\s'"]+|'[^']*'|"[^"]*")+/g)].map(([word]) =>
		word.replace(
			/'([^']*)'|"([^"]*)"/g,
			(_, single, double) => single ?? double
		)
	);
}

/** The line with each placeholder filled in from the fixture */
function fill(line: string): string {
	const used: Record<string, number> = {};
	return (REWRITTEN[line] ?? line).replace(/<[a-zA-Z.-]+>/g, (name) => {
		const values = PLACEHOLDERS[name];
		if (!values) throw new Error(`No fixture value for ${name} in: ${line}`);
		used[name] = (used[name] ?? 0) + 1;
		return values[Math.min(used[name], values.length) - 1];
	});
}

const task = (id: number, extra: object = {}) => ({
	id: String(id),
	title: `Task ${id}`,
	description: `What task ${id} does`,
	status: 'pending',
	priority: 'medium',
	dependencies: [],
	subtasks: [],
	...extra
});
const subtasks = (count: number) =>
	Array.from({ length: count }, (_, i) => ({
		id: String(i + 1),
		title: `Subtask ${i + 1}`,
		description: '',
		status: 'pending',
		dependencies: []
	}));
const tag = (tasks: object[]) => ({
	tasks,
	metadata: { description: 'Fixture', schemaVersion: 2 }
});

/**
 * The tasks the examples name. Free on purpose: task IDs 9, 16-18 and 25,
 * and subtask IDs 5.4 and 7.4, which the move examples move to.
 */
const TASKS = {
	master: tag([
		task(1, { subtasks: subtasks(2) }),
		task(2),
		task(3, {
			subtasks: subtasks(2),
			acceptanceCriteria: [
				{ text: 'Users can log in', checked: true },
				{ text: 'Tokens expire', checked: true },
				{ text: 'Sessions end on logout', checked: true }
			]
		}),
		task(4, { dependencies: ['8'] }),
		task(5, { subtasks: subtasks(3) }),
		task(6),
		task(7, { dependencies: ['2'], subtasks: subtasks(1) }),
		task(8),
		task(10),
		task(11),
		task(12)
	]),
	feature: tag([task(1)]),
	'feature-x': tag([task(6)]),
	'feature-auth': tag([task(1)]),
	backlog: tag([task(5)]),
	'in-progress': tag([])
};

const examples = fs
	.readdirSync(docsDir)
	.filter((file) => /^cli-.*\.mdx$/.test(file))
	.flatMap((file) =>
		bashExamples(fs.readFileSync(path.join(docsDir, file), 'utf8')).map(
			({ text, line }) => ({ at: `${file}:${line}`, text })
		)
	);
const run = examples.filter(({ text }) => !callsAi(text) && !(text in SKIPPED));

// CI runs the root suite on Linux only, and `completion --install` and the
// fixture's git branch are untried on Windows
describe.skipIf(process.platform === 'win32')('CLI reference examples', () => {
	let base: string;
	let template: string;
	let env: NodeJS.ProcessEnv;
	/** Written by a stand-in when the CLI starts an outside program */
	let outsideCalls: string;

	beforeAll(() => {
		if (!fs.existsSync(cli)) {
			throw new Error(`${cli} is missing: run \`npm run build\` first`);
		}
		base = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-docs-'));
		template = path.join(base, 'template');
		const home = path.join(base, 'home');
		const bin = path.join(base, 'bin');
		outsideCalls = path.join(base, 'outside-calls');
		for (const dir of [template, home, bin]) fs.mkdirSync(dir);
		for (const name of OUTSIDE_PROGRAMS) {
			fs.writeFileSync(path.join(bin, name), standIn(name, outsideCalls), {
				mode: 0o755
			});
		}
		// Not process.env: no API key or token, no CLAUDECODE, and no
		// XDG_CONFIG_HOME or ZDOTDIR to send `completion --install` out of `home`
		env = {
			PATH: `${bin}${path.delimiter}${process.env.PATH}`,
			HOME: home,
			USERPROFILE: home,
			SHELL: '/bin/bash',
			TASKGRAPH_SKIP_AUTO_UPDATE: '1',
			NO_COLOR: '1'
		};
		const git = (...args: string[]) =>
			execFileSync('git', args, { cwd: template, env, stdio: 'pipe' });
		// On a branch, for `tags add --from-branch`
		git('init', '-q', '-b', 'feature/docs');
		execFileSync(process.execPath, [cli, 'init', '--yes'], {
			cwd: template,
			env,
			stdio: 'pipe'
		});
		fs.writeFileSync(
			path.join(template, '.taskgraph/tasks/tasks.json'),
			JSON.stringify(TASKS)
		);
		// A branch has a name once it has a commit
		git('add', '-A');
		git(
			'-c',
			'user.name=t',
			'-c',
			'user.email=t@example.com',
			'commit',
			'-qm',
			'init'
		);
		// For `note 3 --file notes.md`
		fs.writeFileSync(path.join(template, 'notes.md'), 'Notes from a file\n');
	}, 60_000);

	afterAll(() => {
		fs.rmSync(base, { recursive: true, force: true, maxRetries: 5 });
	});

	it('finds the examples (guards the extraction)', () => {
		expect(examples.length).toBeGreaterThanOrEqual(150);
		expect(run.length).toBeGreaterThanOrEqual(80);
		expect(run.map(({ text }) => text)).toContain(
			'taskgraph move --from=5 --from-tag=backlog --to-tag=in-progress'
		);
	});

	it('skips only lines the docs still show', () => {
		const shown = new Set(examples.map(({ text }) => text));
		const stale = [...Object.keys(SKIPPED), ...Object.keys(REWRITTEN)];

		expect(stale.filter((line) => !shown.has(line))).toEqual([]);
	});

	// Spawning the CLI is the test, so these run several at a time
	it.concurrent.each(run)(
		'$at: $text',
		async ({ text }) => {
			// `git log … | taskgraph note 3 --file -`: the part after the pipe, fed on stdin
			const command = fill(text.replace(/^.*\|\s*(?=taskgraph )/, ''));
			const project = fs.mkdtempSync(path.join(base, 'p-'));
			fs.cpSync(template, project, { recursive: true });

			const result = await new Promise<{
				error: ExecFileException | null;
				output: string;
			}>((resolve) => {
				const child = execFile(
					process.execPath,
					[cli, ...words(command).slice(1)],
					{ cwd: project, env, timeout: 60_000 },
					(error, stdout, stderr) =>
						resolve({ error, output: `${stdout}${stderr}` })
				);
				child.stdin?.end('Text from a pipe\n');
			});

			expect(command).toMatch(/^taskgraph /);
			expect(result.error, `${command}\n${result.output}`).toBeNull();
		},
		90_000
	);

	// After the examples above: vitest runs a test that isn't concurrent on its own
	it('started no outside program (Claude, GitHub, npm, Docker)', () => {
		const calls = fs.existsSync(outsideCalls)
			? fs.readFileSync(outsideCalls, 'utf8')
			: '';

		expect(calls).toBe('');
	});
});
