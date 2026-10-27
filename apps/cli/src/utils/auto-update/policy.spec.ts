import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { autoUpdateSkipReason, isAutoInstallEnabled } from './policy.js';

const argv = ['node', 'taskgraph', 'upgrade'];

describe('autoUpdateSkipReason', () => {
	it('skips in CI and without a terminal for an automatic update', () => {
		expect(
			autoUpdateSkipReason({ argv, env: { CI: '1' }, stdinIsTTY: true })
		).toBe('CI environment');
		expect(autoUpdateSkipReason({ argv, env: {}, stdinIsTTY: false })).toBe(
			'stdin is not a terminal'
		);
	});

	it('lets an explicit upgrade run in CI and without a terminal', () => {
		expect(
			autoUpdateSkipReason({
				argv,
				env: { CI: '1', TASKGRAPH_SKIP_AUTO_UPDATE: '1' },
				stdinIsTTY: false,
				explicit: true
			})
		).toBeNull();
	});

	it('refuses an explicit upgrade in a process loop started', () => {
		expect(
			autoUpdateSkipReason({
				argv,
				env: { TASKGRAPH_LOOP_CHILD: '1' },
				stdinIsTTY: true,
				explicit: true
			})
		).toBe('started by loop');
		expect(
			autoUpdateSkipReason({
				argv,
				env: { TASKGRAPH_PARALLEL_WORKER: '1' },
				stdinIsTTY: true,
				explicit: true
			})
		).toBe('started by a parallel worker');
	});
});

describe('isAutoInstallEnabled', () => {
	const savedCwd = process.cwd();
	let dir: string;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-policy-'));
		fs.mkdirSync(path.join(dir, '.taskgraph'));
		fs.writeFileSync(
			path.join(dir, '.taskgraph', 'auto-update.json'),
			'{"autoUpdate":"install"}'
		);
	});

	afterEach(() => {
		process.chdir(savedCwd);
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it('reads the opt-in file under the home directory', () => {
		expect(isAutoInstallEnabled({ env: { HOME: dir } })).toBe(true);
	});

	it('does not read the file from the working directory when HOME is empty', () => {
		process.chdir(dir);
		expect(isAutoInstallEnabled({ env: { HOME: '' } })).toBe(false);
	});
});
