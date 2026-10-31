import { describe, expect, it } from 'vitest';
import {
	type ContainerRun,
	DEFAULT_CONTAINER_IMAGE,
	assertContainerFlags,
	assertMountablePath,
	buildContainerArgs,
	checkContainerSetup,
	cloneGitConfig,
	containerRuntimeDown,
	containerRuntimeMissing,
	importedStatus
} from './container.js';

const run = (overrides: Partial<ContainerRun> = {}): ContainerRun => ({
	image: DEFAULT_CONTAINER_IMAGE,
	tokenVar: 'CLAUDE_CODE_OAUTH_TOKEN',
	name: 'taskgraph-task-3-abcd1234',
	clone: '/repo/.taskgraph/worktrees/task-3',
	cwd: '/repo/.taskgraph/worktrees/task-3',
	stateDir: '/repo/.taskgraph/worktrees/task-3.state',
	prompt: "Work on task 3; don't `rm -rf` $HOME",
	claudeArgs: ['--max-turns', '5'],
	taskgraphPackage: 'taskgraph-ai@1.2.3',
	user: '501:20',
	...overrides
});

const after = (args: string[], flag: string) =>
	args.flatMap((a, i) => (args[i - 1] === flag ? [a] : []));

describe('buildContainerArgs', () => {
	it("mounts only the worker's clone and its copy of the TaskGraph files", () => {
		expect(after(buildContainerArgs(run()), '--mount')).toEqual([
			'type=bind,src=/repo/.taskgraph/worktrees/task-3,dst=/repo/.taskgraph/worktrees/task-3',
			'type=bind,src=/repo/.taskgraph/worktrees/task-3.state,dst=/repo/.taskgraph/worktrees/task-3.state'
		]);
	});

	it('passes the token by name only, and points taskgraph at the copy', () => {
		expect(after(buildContainerArgs(run()), '-e')).toEqual([
			'CLAUDE_CODE_OAUTH_TOKEN',
			'TASKGRAPH_PROJECT_ROOT=/repo/.taskgraph/worktrees/task-3.state',
			'HOME=/tmp'
		]);
	});

	it('names the container, runs it as the given user in the project folder', () => {
		const args = buildContainerArgs(run({ cwd: '/repo/wt/app' }));

		expect(args.slice(0, 13)).toEqual([
			'run',
			'--rm',
			'--init',
			'--cap-drop',
			'ALL',
			'--security-opt',
			'no-new-privileges',
			'--name',
			'taskgraph-task-3-abcd1234',
			'--user',
			'501:20',
			'--workdir',
			'/repo/wt/app'
		]);
		expect(buildContainerArgs(run({ user: undefined }))).not.toContain(
			'--user'
		);
	});

	it('ends with the image and a fixed script that gets the prompt, package and Claude arguments as arguments', () => {
		const args = buildContainerArgs(run({ image: 'my/image:1' }));
		const at = args.indexOf('my/image:1');

		expect(args.slice(at - 2, at)).toEqual(['--entrypoint', 'sh']);
		expect(args[at + 1]).toBe('-c');
		expect(args[at + 2]).not.toContain('task 3');
		expect(args[at + 2]).not.toContain('latest');
		expect(args.slice(at + 3)).toEqual([
			'sh',
			"Work on task 3; don't `rm -rf` $HOME",
			'taskgraph-ai@1.2.3',
			'--max-turns',
			'5'
		]);
		expect(args[at + 2]).toContain('shift 2;');
		expect(args[at + 2]).toContain(
			'claude -p "$p" --dangerously-skip-permissions "$@"'
		);
	});

	it('refuses a path with a comma, which would split a --mount value', () => {
		expect(() => buildContainerArgs(run({ clone: '/a,b' }))).toThrow(
			"--container can't mount"
		);
	});
});

describe('assertMountablePath', () => {
	it('refuses commas, quotes and line breaks', () => {
		for (const p of ['/a,b', '/a"b', '/a\nb', '/a\rb']) {
			expect(() => assertMountablePath(p)).toThrow();
		}
		expect(() => assertMountablePath('/home/me/my project')).not.toThrow();
	});
});

describe('checkContainerSetup', () => {
	const env = { CLAUDE_CODE_OAUTH_TOKEN: 't' };

	it('prefers CLAUDE_CODE_OAUTH_TOKEN, then ANTHROPIC_API_KEY', () => {
		expect(
			checkContainerSetup({
				env: { ...env, ANTHROPIC_API_KEY: 'k' },
				platform: 'linux'
			})
		).toEqual({
			image: DEFAULT_CONTAINER_IMAGE,
			tokenVar: 'CLAUDE_CODE_OAUTH_TOKEN'
		});
		expect(
			checkContainerSetup({
				env: { CLAUDE_CODE_OAUTH_TOKEN: ' ', ANTHROPIC_API_KEY: 'k' },
				platform: 'darwin'
			}).tokenVar
		).toBe('ANTHROPIC_API_KEY');
	});

	it('refuses with a fix when neither token is set', () => {
		expect(() => checkContainerSetup({ env: {}, platform: 'linux' })).toThrow(
			expect.objectContaining({
				message:
					'--container needs CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY',
				hint: 'Run `claude setup-token`, then export CLAUDE_CODE_OAUTH_TOKEN'
			})
		);
	});

	it('refuses Windows, pointing at WSL', () => {
		expect(() => checkContainerSetup({ env, platform: 'win32' })).toThrow(
			expect.objectContaining({ hint: expect.stringContaining('WSL') })
		);
	});

	it('takes an image name, and refuses one that looks like a flag or has spaces', () => {
		expect(
			checkContainerSetup({
				image: 'ghcr.io/me/img:1@sha256:ab',
				env,
				platform: 'linux'
			}).image
		).toBe('ghcr.io/me/img:1@sha256:ab');
		for (const image of ['--privileged', 'a b', 'im\ng']) {
			expect(() =>
				checkContainerSetup({ image, env, platform: 'linux' })
			).toThrow("isn't an image name");
		}
	});
});

describe('runtime errors', () => {
	it('tell a missing runtime from a stopped one, each in one short line', () => {
		const missing = containerRuntimeMissing('docker');
		const down = containerRuntimeDown('docker');

		expect(missing.message).toBe(
			"--container needs docker, and it isn't on PATH"
		);
		expect(down.message).toBe("docker is installed but isn't running");
		expect(down.hint).toBe('Start Docker and try again');
		for (const line of [missing.message, missing.hint, down.message]) {
			expect(`✗ ${line}`.length).toBeLessThanOrEqual(80);
		}
	});
});

describe('cloneGitConfig', () => {
	it('holds only the format and the identity, quoted', () => {
		expect(
			cloneGitConfig({
				objectFormat: 'sha1',
				userName: 'Ann "A" \\ Lee',
				userEmail: 'ann@example.com'
			})
		).toBe(
			[
				'[core]',
				'\trepositoryformatversion = 0',
				'\tbare = false',
				'[user]',
				'\tname = "Ann \\"A\\" \\\\ Lee"',
				'\temail = "ann@example.com"',
				''
			].join('\n')
		);
	});

	it('keeps a sha256 repository readable, and drops line breaks', () => {
		const config = cloneGitConfig({
			objectFormat: 'sha256',
			userName: 'a\nb',
			userEmail: 'e'
		});

		expect(config).toContain('repositoryformatversion = 1');
		expect(config).toContain('objectformat = sha256');
		expect(config).toContain('name = "a b"');
	});
});

describe('importedStatus', () => {
	const file = (tasks: unknown, tag = 'master') =>
		JSON.stringify({ [tag]: { tasks } });

	it("reads the task's status in the tag", () => {
		expect(
			importedStatus(
				file([
					{ id: 2, status: 'done' },
					{ id: '3', status: 'review' }
				]),
				'3',
				'master'
			)
		).toBe('review');
	});

	it('ignores an unknown status, another tag, broken JSON and odd shapes', () => {
		for (const status of ['shipped', 'done', 'cancelled', 'pending']) {
			expect(
				importedStatus(file([{ id: '3', status }]), '3', 'master')
			).toBeUndefined();
		}
		expect(
			importedStatus(
				file([{ id: '3', status: 'done' }], 'other'),
				'3',
				'master'
			)
		).toBeUndefined();
		expect(importedStatus('{not json', '3', 'master')).toBeUndefined();
		expect(importedStatus('null', '3', 'master')).toBeUndefined();
		expect(importedStatus(file('x'), '3', 'master')).toBeUndefined();
		expect(importedStatus(file([null, 7]), '3', 'master')).toBeUndefined();
		expect(
			importedStatus('{"__proto__": {"tasks": []}}', '3', '__proto__')
		).toBeUndefined();
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
