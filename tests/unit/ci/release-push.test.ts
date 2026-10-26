/**
 * .github/scripts/release-push.sh pushes the release commit and tag. When main
 * moves during the job the push is rejected; that is a skip, not a failure,
 * because the newer commit's run releases both (#714).
 */

import { execFileSync, spawnSync } from 'node:child_process';
import {
	chmodSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(__dirname, '../../../.github/scripts/release-push.sh');
const env = {
	...process.env,
	GIT_AUTHOR_NAME: 'test',
	GIT_AUTHOR_EMAIL: 'test@example.com',
	GIT_COMMITTER_NAME: 'test',
	GIT_COMMITTER_EMAIL: 'test@example.com',
	GIT_CONFIG_NOSYSTEM: '1',
	GIT_CONFIG_GLOBAL: '/dev/null'
};

let dir: string;
let origin: string;
let work: string;
let tested: string;

function git(cwd: string, ...args: string[]): string {
	return execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
}

function commit(cwd: string, message: string): void {
	git(cwd, 'commit', '--allow-empty', '-q', '-m', message);
}

/** Runs the script after a release commit and tag, as the workflow does */
function releasePush() {
	commit(work, 'chore(release): v1.0.1 [skip ci]');
	git(work, 'tag', 'v1.0.1');
	const output = join(dir, 'github-output');
	writeFileSync(output, '');
	const result = spawnSync(SCRIPT, {
		cwd: work,
		env: { ...env, TAG: 'v1.0.1', TESTED_SHA: tested, GITHUB_OUTPUT: output },
		encoding: 'utf8'
	});
	return { status: result.status, output: readFileSync(output, 'utf8') };
}

/** The sha `ref` points at in origin, or '' when it does not exist */
function remoteRef(ref: string): string {
	return spawnSync('git', ['rev-parse', '--verify', '--quiet', ref], {
		cwd: origin,
		encoding: 'utf8'
	}).stdout.trim();
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'release-push-'));
	origin = join(dir, 'origin.git');
	work = join(dir, 'work');
	git(dir, 'init', '-q', '--bare', '-b', 'main', origin);
	git(dir, 'clone', '-q', origin, work);
	commit(work, 'feat: thing');
	git(work, 'push', '-q', 'origin', 'HEAD:main');
	tested = git(work, 'rev-parse', 'HEAD');
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe('release-push.sh', () => {
	it('pushes the release commit and tag when main has not moved', () => {
		const { status, output } = releasePush();

		expect(status).toBe(0);
		expect(output).toBe('pushed=true\n');
		expect(remoteRef('refs/heads/main')).toBe(git(work, 'rev-parse', 'HEAD'));
		expect(remoteRef('refs/tags/v1.0.1')).not.toBe('');
	});

	it('skips without pushing anything when main moved during the job', () => {
		const other = join(dir, 'other');
		git(dir, 'clone', '-q', origin, other);
		commit(other, 'fix: landed meanwhile');
		git(other, 'push', '-q', 'origin', 'HEAD:main');
		const moved = remoteRef('refs/heads/main');

		const { status, output } = releasePush();

		expect(status).toBe(0);
		expect(output).toBe('pushed=false\n');
		expect(remoteRef('refs/heads/main')).toBe(moved);
		expect(remoteRef('refs/tags/v1.0.1')).toBe('');
	});

	it('fails when the push is rejected and main has not moved', () => {
		const hook = join(origin, 'hooks', 'pre-receive');
		writeFileSync(hook, '#!/bin/sh\nexit 1\n');
		chmodSync(hook, 0o755);

		const { status, output } = releasePush();

		expect(status).toBe(1);
		expect(output).toBe('');
	});
});
