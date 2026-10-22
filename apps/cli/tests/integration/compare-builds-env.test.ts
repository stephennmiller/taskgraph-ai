/**
 * @fileoverview The build comparison keeps git steps, and the dates tag copy
 * writes, from depending on the machine that runs it.
 *
 * @integration
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getCliBinPath } from '../helpers/test-utils.js';
import { buildEnv } from '../parity/compare-builds.mjs';
import { normalizeSnapshot } from '../parity/normalize.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const compareScript = path.resolve(here, '../parity/compare-builds.mjs');
const fixture = path.resolve(here, '../parity/fixtures/tasks-tagged.json');
const cli = getCliBinPath();
const built = fs.existsSync(cli);
const real = `node "${cli}"`;
const ctx = { projectDir: '/tmp/proj-a', workDir: '/tmp/work-a' };

describe('buildEnv', () => {
	it('removes variables that point git at another repository or config', () => {
		const env = buildEnv('/tmp/work-x', {
			HOME: '/home/dev',
			GIT_DIR: '/real/.git',
			GIT_WORK_TREE: '/real',
			GIT_INDEX_FILE: '/real/.git/index',
			GIT_COMMON_DIR: '/real/.git',
			GIT_OBJECT_DIRECTORY: '/real/.git/objects',
			GIT_CONFIG_GLOBAL: '/home/dev/.gitconfig',
			GIT_CONFIG_COUNT: '1',
			GIT_CONFIG_KEY_0: 'core.hooksPath',
			GIT_CONFIG_VALUE_0: '/hooks',
			GIT_TEMPLATE_DIR: '/tpl',
			PATH: '/usr/bin'
		});

		expect(Object.keys(env).filter((k) => /^GIT_/.test(k))).toEqual([
			'GIT_CONFIG_NOSYSTEM'
		]);
		expect(env.GIT_CONFIG_NOSYSTEM).toBe('1');
		expect(env.PATH).toBe('/usr/bin');
	});
});

describe('normalizeSnapshot', () => {
	it('masks locale dates in project files, so a run across midnight stays equal', () => {
		const out = normalizeSnapshot(
			'tasks.json',
			JSON.stringify({
				a: { metadata: { description: 'Copied on 10/22/2026' } }
			}),
			ctx
		);

		expect(out).toContain('Copied on <date>');
	});
});

describe.skipIf(!built)('compare-builds script and git', () => {
	let work: string;

	beforeEach(() => {
		work = fs.mkdtempSync(path.join(os.tmpdir(), 'compare-builds-git-'));
	});

	afterEach(() => {
		fs.rmSync(work, { recursive: true, force: true });
	});

	const scenario = (steps: unknown[]) => {
		const file = path.join(work, 'scenario.json');
		fs.writeFileSync(file, JSON.stringify({ fixture, steps }, null, 2));
		return file;
	};

	it('leaves a repository named by GIT_DIR untouched when a step runs git', () => {
		const other = path.join(work, 'other');
		fs.mkdirSync(other);
		spawnSync('git', ['init', '-q', '-b', 'keep'], { cwd: other });
		const gitDir = path.join(other, '.git');
		const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8');
		const file = scenario([
			{
				shell:
					'git checkout -q -b topic && git -c user.name=x -c user.email=y commit -q --allow-empty -m x'
			}
		]);

		const res = spawnSync(
			process.execPath,
			[compareScript, '--a', real, '--b', real, '--scenario', file],
			{
				encoding: 'utf8',
				timeout: 120000,
				env: {
					...process.env,
					GIT_DIR: gitDir,
					TASKGRAPH_SKIP_AUTO_UPDATE: '1'
				}
			}
		);

		expect(res.status, res.stdout + res.stderr).toBe(0);
		expect(fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8')).toBe(head);
		expect(fs.readdirSync(path.join(gitDir, 'refs', 'heads'))).toEqual([]);
	});
});
