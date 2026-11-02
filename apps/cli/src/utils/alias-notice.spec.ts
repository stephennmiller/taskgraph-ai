/**
 * @fileoverview The old-name notice: one dim line on stderr (#930).
 */

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { theme } from '../ui/theme.js';
import { noticeOldAlias } from './alias-notice.js';

const strip = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '');

function run() {
	const command = new Command('add-dependency').exitOverride().action(() => {});
	noticeOldAlias(command, 'depend');
	return command.parseAsync([], { from: 'user' });
}

describe('noticeOldAlias', () => {
	let err: string[];
	let out: string[];

	beforeEach(() => {
		err = [];
		out = [];
		vi.spyOn(console, 'error').mockImplementation((line?: unknown) => {
			err.push(String(line));
		});
		vi.spyOn(console, 'log').mockImplementation((line?: unknown) => {
			out.push(String(line));
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('prints one dim line on stderr and nothing on stdout', async () => {
		await run();

		expect(err).toEqual([
			theme.muted('(add-dependency is now taskgraph depend)')
		]);
		expect(strip(err[0])).toBe('(add-dependency is now taskgraph depend)');
		expect(err[0].startsWith('\n')).toBe(false);
		expect(out).toEqual([]);
	});
});
