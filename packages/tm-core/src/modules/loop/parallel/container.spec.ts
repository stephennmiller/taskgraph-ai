import { describe, expect, it } from 'vitest';
import {
	type ContainerRun,
	DEFAULT_CONTAINER_IMAGE,
	assertContainerFlags,
	buildContainerArgs,
	containerRuntimeMissing,
	containerTokenVar
} from './container.js';

const run = (overrides: Partial<ContainerRun> = {}): ContainerRun => ({
	image: DEFAULT_CONTAINER_IMAGE,
	tokenVar: 'CLAUDE_CODE_OAUTH_TOKEN',
	projectRoot: '/repo',
	worktree: '/repo/.taskgraph/worktrees/task-3',
	cwd: '/repo/.taskgraph/worktrees/task-3',
	gitCommonDir: '/repo/.git',
	prompt: "Work on task 3; don't `rm -rf` $HOME",
	taskgraphPackage: 'taskgraph-ai@1.2.3',
	user: '501:20',
	exists: () => true,
	...overrides
});

/** The --mount values, in order */
const mounts = (args: string[]) =>
	args.flatMap((a, i) => (args[i - 1] === '--mount' ? [a] : []));

describe('buildContainerArgs', () => {
	it('mounts the worktree, .git with its config and hooks read-only, and the task files', () => {
		expect(mounts(buildContainerArgs(run()))).toEqual([
			'type=bind,src=/repo/.taskgraph/worktrees/task-3,dst=/repo/.taskgraph/worktrees/task-3',
			'type=bind,src=/repo/.git,dst=/repo/.git',
			'type=bind,src=/repo/.git/config,dst=/repo/.git/config,readonly',
			'type=bind,src=/repo/.git/hooks,dst=/repo/.git/hooks,readonly',
			'type=bind,src=/repo/.taskgraph/tasks,dst=/repo/.taskgraph/tasks',
			'type=bind,src=/repo/.taskgraph/config.json,dst=/repo/.taskgraph/config.json,readonly',
			'type=bind,src=/repo/.taskgraph/state.json,dst=/repo/.taskgraph/state.json,readonly'
		]);
	});

	it('leaves out config.json and state.json when the project has none', () => {
		const args = buildContainerArgs(run({ exists: () => false }));

		expect(mounts(args).some((m) => m.includes('config.json'))).toBe(false);
		expect(mounts(args).some((m) => m.includes('state.json'))).toBe(false);
	});

	it('passes the token by name only, never its value', () => {
		const args = buildContainerArgs(run());

		const envs = args.flatMap((a, i) => (args[i - 1] === '-e' ? [a] : []));
		expect(envs).toEqual([
			'CLAUDE_CODE_OAUTH_TOKEN',
			'TASKGRAPH_PROJECT_ROOT=/repo',
			'HOME=/tmp'
		]);
	});

	it('runs as the given user in the project folder, removed on exit', () => {
		const args = buildContainerArgs(run({ cwd: '/repo/wt/app' }));

		expect(args.slice(0, 7)).toEqual([
			'run',
			'--rm',
			'--init',
			'--user',
			'501:20',
			'--workdir',
			'/repo/wt/app'
		]);
		expect(buildContainerArgs(run({ user: undefined }))).not.toContain(
			'--user'
		);
	});

	it('ends with the image and a fixed script that gets the prompt and package as arguments', () => {
		const args = buildContainerArgs(run({ image: 'my/image:1' }));
		const at = args.indexOf('my/image:1');

		expect(args[at - 2]).toBe('--entrypoint');
		expect(args[at - 1]).toBe('sh');
		expect(args[at + 1]).toBe('-c');
		expect(args[at + 2]).not.toContain('task 3');
		expect(args.slice(at + 3)).toEqual([
			'sh',
			"Work on task 3; don't `rm -rf` $HOME",
			'taskgraph-ai@1.2.3'
		]);
	});

	it('refuses a path with a comma, which would split a --mount value', () => {
		expect(() => buildContainerArgs(run({ projectRoot: '/a,b' }))).toThrow(
			"--container can't mount /a,b/.taskgraph/tasks: the path has a comma in it"
		);
	});
});

describe('containerTokenVar', () => {
	it('prefers CLAUDE_CODE_OAUTH_TOKEN, then ANTHROPIC_API_KEY', () => {
		expect(
			containerTokenVar({
				CLAUDE_CODE_OAUTH_TOKEN: 't',
				ANTHROPIC_API_KEY: 'k'
			})
		).toBe('CLAUDE_CODE_OAUTH_TOKEN');
		expect(
			containerTokenVar({
				CLAUDE_CODE_OAUTH_TOKEN: ' ',
				ANTHROPIC_API_KEY: 'k'
			})
		).toBe('ANTHROPIC_API_KEY');
	});

	it('refuses with a fix when neither is set', () => {
		expect(() => containerTokenVar({})).toThrow(
			expect.objectContaining({
				message:
					'--container needs CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY set: the containers get no access to your Claude Code login',
				hint: 'Run `claude setup-token` and export the token it prints as CLAUDE_CODE_OAUTH_TOKEN'
			})
		);
	});
});

describe('containerRuntimeMissing', () => {
	it('names the runtime and how to get it', () => {
		const error = containerRuntimeMissing('docker');

		expect(error.message).toBe(
			"--container needs docker, and it isn't installed or isn't on PATH"
		);
		expect(error.hint).toContain('drop --container');
	});
});

describe('assertContainerFlags', () => {
	it('allows --container with --parallel, and neither', () => {
		expect(() =>
			assertContainerFlags({ parallel: '2', container: true })
		).not.toThrow();
		expect(() => assertContainerFlags({})).not.toThrow();
	});

	it('refuses --container without --parallel', () => {
		expect(() => assertContainerFlags({ container: true })).toThrow(
			'--container only works with --parallel'
		);
	});

	it('refuses --container-image without --container', () => {
		expect(() =>
			assertContainerFlags({ parallel: '2', containerImage: 'x' })
		).toThrow('--container-image only works with --container');
	});
});
