import { EventEmitter } from 'node:events';
import { SKIP_AUTO_UPDATE_ENV } from '@tm/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('child_process', async (importOriginal) => {
	const actual = await importOriginal<typeof import('child_process')>();
	return { ...actual, spawn };
});

import { restartWithNewVersion } from './restart.js';

describe('restartWithNewVersion', () => {
	const platform = process.platform;
	const argv = [
		'C:\\Program Files\\nodejs\\node.exe',
		'C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\taskgraph-ai\\dist\\taskgraph.js',
		'add-task',
		'--description',
		'R&D notes'
	];

	beforeEach(() => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		spawn.mockReset();
		spawn.mockReturnValue(new EventEmitter());
	});

	afterEach(() => {
		Object.defineProperty(process, 'platform', { value: platform });
		vi.restoreAllMocks();
	});

	it('re-runs the installed entry script with node and no shell on Windows', () => {
		Object.defineProperty(process, 'platform', { value: 'win32' });

		restartWithNewVersion(argv);

		const [cmd, args, options] = spawn.mock.calls[0];
		expect(cmd).toBe(process.execPath);
		// Each argument stays whole: no shell joins them or reads the `&`
		expect(args).toEqual(argv.slice(1));
		expect(options.shell).toBeFalsy();
	});

	it('does not check for an update again in the restarted run', () => {
		restartWithNewVersion(argv);

		const [, , options] = spawn.mock.calls[0];
		expect(options.env[SKIP_AUTO_UPDATE_ENV]).toBe('1');
	});
});
