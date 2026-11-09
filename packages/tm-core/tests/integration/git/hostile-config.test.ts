/**
 * @fileoverview The git calls TaskGraph makes before anyone approved the
 * project (show, list, the loop approval check, the repository summary) in
 * a repository whose config names a program for every key that can start
 * one. None may run (#1100).
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
import { findTaskCommits } from '../../../src/modules/tasks/utils/task-commits.js';

/** Hooks git could run on a read, were one of these calls to write the index or a ref */
const HOOKS = ['post-index-change', 'reference-transaction', 'post-checkout'];

describe('git calls before approval, in a repository with a hostile config', () => {
	let base: string;
	let repo: string;
	let marker: string;
	const git = (...args: string[]) =>
		execFileSync('git', args, { cwd: repo, stdio: 'pipe' }).toString().trim();

	beforeEach(() => {
		base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tm-cfg-')));
		repo = path.join(base, 'repo');
		marker = path.join(base, 'ran');
		fs.mkdirSync(path.join(repo, 'tools', 'hooks'), { recursive: true });
		fs.mkdirSync(path.join(base, 'home'));
		// Git for Windows runs these through its own sh, with forward slashes
		const program = path.join(repo, 'tools', 'run').replace(/\\/g, '/');
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
		// Changed on disk, so a call that compared files would run the filter
		fs.writeFileSync(path.join(repo, 'README.md'), '# Readme\n\nMore\n');
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
			['filter.x.process', program]
		]) {
			git('config', key, value);
		}
		fs.rmSync(marker, { force: true });
	});

	afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

	// The fixture is only worth something if plain git does start the program
	it.skipIf(process.platform === 'win32')(
		'plain git log starts the configured program',
		() => {
			git('log', '--format=%h');

			expect(fs.readFileSync(marker, 'utf8')).toContain('--verify');
		}
	);

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

		expect(commits).toEqual([
			expect.objectContaining({ subject: 'work [task 1]' })
		]);
		expect(fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8') : '').toBe(
			''
		);
	});
});
