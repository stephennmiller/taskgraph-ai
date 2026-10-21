import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('child_process', () => ({ spawn }));
vi.mock('../../ui/spinner.js', () => ({
	createSpinner: () => ({
		start() {
			return { succeed() {}, fail() {}, text: '' };
		}
	})
}));

import { performAutoUpdate } from './install.js';

function fakeNpm(exitCode: number) {
	const child: any = new EventEmitter();
	child.stdout = new EventEmitter();
	child.stderr = new EventEmitter();
	setImmediate(() => child.emit('close', exitCode));
	return child;
}

describe('performAutoUpdate', () => {
	const saved = { ...process.env };

	beforeEach(() => {
		delete process.env.CI;
		delete process.env.TASKGRAPH_SKIP_AUTO_UPDATE;
		process.env.NODE_ENV = 'production';
		vi.spyOn(console, 'log').mockImplementation(() => {});
		spawn.mockReset();
	});

	afterEach(() => {
		process.env = { ...saved };
		vi.restoreAllMocks();
	});

	it('installs through npm so npm checks the package integrity', async () => {
		spawn.mockReturnValue(fakeNpm(0));

		await expect(performAutoUpdate('1.2.3')).resolves.toBe(true);

		expect(spawn).toHaveBeenCalledTimes(1);
		const [cmd, args] = spawn.mock.calls[0];
		expect(cmd).toBe('npm');
		expect(args.slice(0, 3)).toEqual(['install', '-g', 'taskgraph-ai@1.2.3']);
	});

	it('reports failure when npm exits non-zero', async () => {
		spawn.mockReturnValue(fakeNpm(1));

		await expect(performAutoUpdate('1.2.3')).resolves.toBe(false);
	});

	it('does nothing in CI', async () => {
		process.env.CI = '1';

		await expect(performAutoUpdate('1.2.3')).resolves.toBe(false);
		expect(spawn).not.toHaveBeenCalled();
	});
});
