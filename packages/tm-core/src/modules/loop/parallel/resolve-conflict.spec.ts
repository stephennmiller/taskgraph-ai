import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveConflict } from './resolve-conflict.js';

describe('resolveConflict', () => {
	let dir: string;
	/** A stand-in for claude that prints this and exits with this code */
	const fakeClaude = (stdout: string, code = 0) => {
		const file = path.join(dir, 'claude');
		fs.writeFileSync(
			file,
			`#!/bin/sh\nprintf '%s' '${stdout}'\nexit ${code}\n`
		);
		fs.chmodSync(file, 0o755);
		return file;
	};
	const run = (command: string) =>
		resolveConflict({
			projectRoot: dir,
			worktree: dir,
			branch: 'taskgraph/task-2',
			commit: 'abc123',
			command,
			maxBudgetUsd: 1.5
		});

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-resolve-'));
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it.skipIf(process.platform === 'win32')(
		'reports success and the cost Claude Code printed',
		async () => {
			expect(await run(fakeClaude('{"total_cost_usd":0.12}'))).toEqual({
				ok: true,
				costUsd: 0.12
			});
		}
	);

	it.skipIf(process.platform === 'win32')(
		'counts the whole budget when Claude Code dies without a result',
		async () => {
			expect(await run(fakeClaude('', 1))).toEqual({
				ok: false,
				costUsd: 1.5
			});
		}
	);
});
