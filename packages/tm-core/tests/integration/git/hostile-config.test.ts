/**
 * @fileoverview The git calls TaskGraph makes before anyone approved the
 * project (show, list, the loop approval check, the repository summary) in
 * a repository whose config names a program for every key that can start
 * one. None may run (#1100). A sandboxed loop run must not run `git status`,
 * which starts a filter: it asks for no approval (#1129), and its session
 * can write the mounted `.git/config` after one was given (#1133). A partial
 * clone's remote names a program too, which git starts to fetch an object
 * the repository doesn't have (#1138).
 */

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	getCurrentBranch,
	getHeadCommit,
	isGitRepository,
	runGit,
	runGitSync
} from '../../../src/common/utils/git-utils.js';
import { getRepoSummary } from '../../../src/modules/codebase/repo-summary.js';
import {
	isLoopTrusted,
	trustLoop
} from '../../../src/modules/loop/loop-trust.js';
import { TaskWorktrees } from '../../../src/modules/loop/parallel/task-worktrees.js';
import { fakeClaude } from '../../../src/modules/loop/services/fake-claude.js';
import { findTaskCommits } from '../../../src/modules/tasks/utils/task-commits.js';
import { createTmCore } from '../../../src/tm-core.js';

// Only the Claude (here: docker) process is faked; git runs for real
vi.mock('node:child_process', async (importOriginal) => ({
	...(await importOriginal<typeof import('node:child_process')>()),
	spawn: vi.fn()
}));

/** Hooks git could run on a read, were one of these calls to write the index or a ref */
const HOOKS = ['post-index-change', 'reference-transaction', 'post-checkout'];

/** An object no repository here has */
const MISSING = '1'.repeat(40);

describe('git calls before approval, in a repository with a hostile config', () => {
	let base: string;
	let repo: string;
	let marker: string;
	/** The program every config key names; it writes its arguments to `marker` */
	let program: string;
	const git = (...args: string[]) =>
		execFileSync('git', args, { cwd: repo, stdio: 'pipe' }).toString().trim();

	beforeEach(() => {
		base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tm-cfg-')));
		repo = path.join(base, 'repo');
		marker = path.join(base, 'ran');
		fs.mkdirSync(path.join(repo, 'tools', 'hooks'), { recursive: true });
		fs.mkdirSync(path.join(base, 'home'));
		// Git for Windows runs these through its own sh, with forward slashes
		program = path.join(repo, 'tools', 'run').replace(/\\/g, '/');
		const script = `#!/bin/sh\necho "$0 $*" >> '${marker.replace(/\\/g, '/')}'\n`;
		for (const file of ['run', ...HOOKS.map((hook) => `hooks/${hook}`)]) {
			fs.writeFileSync(path.join(repo, 'tools', file), script, { mode: 0o755 });
		}
		fs.writeFileSync(path.join(repo, '.gitattributes'), '* filter=x diff=x\n');
		fs.writeFileSync(path.join(repo, 'CLAUDE.local.md'), 'Mine\n');
		fs.writeFileSync(path.join(repo, 'README.md'), '# Readme\n');
		fs.mkdirSync(path.join(repo, '.taskgraph', 'tasks'), { recursive: true });
		fs.writeFileSync(
			path.join(repo, '.taskgraph', 'tasks', 'tasks.json'),
			JSON.stringify({ master: { tasks: [], metadata: {} } })
		);
		git('init', '-q');
		git('add', '-A');
		// A commit with a signature header needs no key when written by hand
		const commit = execFileSync(
			'git',
			['hash-object', '-t', 'commit', '-w', '--stdin'],
			{
				cwd: repo,
				input: [
					`tree ${git('write-tree')}`,
					'author a <a@b.c> 1700000000 +0000',
					'committer a <a@b.c> 1700000000 +0000',
					'gpgsig -----BEGIN PGP SIGNATURE-----',
					' ',
					' x',
					' -----END PGP SIGNATURE-----',
					'',
					'work [task 1]',
					''
				].join('\n')
			}
		)
			.toString()
			.trim();
		git('update-ref', 'HEAD', commit);
		// Changed on disk at the same size, so a call that compared files
		// (`git status`) has to read it through the filter
		fs.writeFileSync(path.join(repo, 'README.md'), '# Edited\n');
		fs.utimesSync(path.join(repo, 'README.md'), 1e9, 1e9);
		// Last, so that building the repository runs none of them
		for (const [key, value] of [
			['log.showSignature', 'true'],
			['gpg.program', program],
			['gpg.ssh.program', program],
			['gpg.x509.program', program],
			['core.fsmonitor', program],
			['core.pager', program],
			['pager.log', program],
			['core.hooksPath', path.dirname(program) + '/hooks'],
			['diff.external', program],
			['diff.x.command', program],
			['diff.x.textconv', program],
			['filter.x.clean', program],
			['filter.x.smudge', program],
			['filter.x.process', program],
			// A partial clone fetches a missing object from its remote by
			// starting the remote's uploadpack; the mailmap blob is one `git
			// log` opens. A repository can allow the transport, so config
			// that forbids it would be no guard
			['extensions.partialClone', 'origin'],
			['remote.origin.promisor', 'true'],
			['remote.origin.url', repo],
			['remote.origin.uploadpack', program],
			['protocol.allow', 'always'],
			['protocol.file.allow', 'always'],
			['mailmap.blob', MISSING]
		]) {
			git('config', key, value);
		}
		fs.rmSync(marker, { force: true });
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		fs.rmSync(base, { recursive: true, force: true });
	});

	const ran = () =>
		fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8') : '';

	/**
	 * A loop on in-progress task 1, which no session finishes. Returns the
	 * prompt each session would get and, from git's own trace, every git
	 * command the run started on the host. `session` runs when a session starts.
	 */
	const loopPrompts = async (
		run: { sandbox: boolean; approve: boolean; iterations?: number },
		session: () => void = () => {}
	) => {
		const home = path.join(base, 'home');
		vi.stubEnv('HOME', home);
		vi.stubEnv('USERPROFILE', home);
		fs.writeFileSync(
			path.join(repo, '.taskgraph', 'tasks', 'tasks.json'),
			JSON.stringify({
				master: {
					tasks: [
						{
							id: 1,
							title: 'Task 1',
							description: '',
							status: 'in-progress',
							priority: 'medium',
							dependencies: [],
							subtasks: []
						}
					]
				}
			})
		);
		if (run.approve) trustLoop(repo, home);
		const trace = path.join(base, 'trace');
		vi.stubEnv('GIT_TRACE', trace);
		vi.mocked(spawn).mockReset();
		vi.mocked(spawn).mockImplementation(() => {
			session();
			return fakeClaude() as never;
		});
		const tmCore = await createTmCore({ projectPath: repo });
		try {
			await tmCore.loop.run({
				sandbox: run.sandbox,
				iterations: run.iterations ?? 1,
				sleepSeconds: 0,
				taskId: '1'
			});
		} finally {
			await tmCore.close();
		}
		return {
			prompts: vi.mocked(spawn).mock.calls.map((call) => call[1].join('\n')),
			hostGit: fs
				.readFileSync(trace, 'utf8')
				.split('\n')
				.flatMap((line) => line.match(/trace: built-in: git (.*)$/)?.[1] ?? [])
		};
	};

	// The fixture is only worth something if plain git does start the program
	it.skipIf(process.platform === 'win32')(
		'plain git log starts the configured program',
		() => {
			git('log', '--format=%h');

			expect(fs.readFileSync(marker, 'utf8')).toContain('--verify');
		}
	);

	it.skipIf(process.platform === 'win32')(
		'plain git log, signatures off, starts the partial-clone remote program',
		() => {
			git('-c', 'log.showSignature=false', 'log', '--format=%h');

			expect(ran()).toContain(`run ${repo}`);
		}
	);

	it.skipIf(process.platform === 'win32')(
		'plain git status starts the configured filter',
		() => {
			// The marker script doesn't speak the process protocol, which fails git
			git('config', '--unset', 'filter.x.process');

			git('status', '--porcelain');

			expect(ran()).not.toBe('');
		}
	);

	it('a sandboxed loop start nobody approved starts none of them', async () => {
		const { prompts, hostGit } = await loopPrompts({
			sandbox: true,
			approve: false
		});

		expect(prompts[0]).toContain('Work on task 1 only');
		// Told to look for itself; the host never listed the files
		expect(prompts[0]).toContain('Task 1 was in progress');
		expect(prompts[0]).not.toContain('README.md');
		expect(hostGit).not.toEqual([]);
		expect(ran()).toBe('');
	});

	it('a sandboxed loop whose session rewrote the git config after approval starts none of them, and asks git on the host only for the last commit', async () => {
		// What a session can do to the mounted project: a filter under a name
		// no pinned `-c` knows, and a changed file for `git status` to read
		const session = () => {
			fs.appendFileSync(
				path.join(repo, '.git', 'config'),
				`[filter "y"]\n\tclean = ${program}\n\tsmudge = ${program}\n`
			);
			fs.writeFileSync(path.join(repo, '.gitattributes'), '* filter=y\n');
			fs.writeFileSync(path.join(repo, 'README.md'), '# Again\n');
		};

		const { prompts, hostGit } = await loopPrompts(
			{ sandbox: true, approve: true, iterations: 2 },
			session
		);

		expect(prompts).toHaveLength(2);
		for (const prompt of prompts) {
			expect(prompt).toContain('Task 1 was in progress');
			expect(prompt).not.toContain('README.md');
		}
		expect(ran()).toBe('');
		// The last commit, before the first iteration and after each one
		expect(hostGit).toEqual(Array(3).fill('rev-parse --verify --quiet HEAD'));
	});

	it('a loop on this machine in an approved project names the uncommitted files', async () => {
		git('config', '--unset', 'filter.x.process');

		const { prompts } = await loopPrompts({
			sandbox: false,
			approve: true
		});

		expect(prompts[0]).toMatch(/Task 1 was interrupted\. .*README\.md/);
	});

	it('starts none of them', async () => {
		const home = path.join(base, 'home');
		const options = { cwd: repo };

		const commits = await findTaskCommits(repo, '1');
		await isGitRepository(repo);
		await getHeadCommit(repo);
		await getCurrentBranch(repo);
		runGitSync(['ls-files', '-z'], options);
		await runGit(['ls-files', '--error-unmatch', '--', 'README.md'], options);
		getRepoSummary(repo);
		isLoopTrusted(repo, home);
		trustLoop(repo, home);
		// What `loop --parallel --container` checks before it asks
		const worktrees = new TaskWorktrees(repo);
		await worktrees.head();
		await worktrees.identity();
		await worktrees.objectFormat();
		// Any call that opens an object the repository lacks
		await runGit(['cat-file', '-e', MISSING], options).catch(() => {});

		expect(commits).toEqual([
			expect.objectContaining({ subject: 'work [task 1]' })
		]);
		expect(ran()).toBe('');
	});
});
