/**
 * @fileoverview Integration test for `taskgraph --help`, run against the built
 * CLI so a broken displayHelp -> ui.formatHelp wiring fails here.
 */

import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { getCliBinPath } from '../../helpers/test-utils.js';

const stripAnsi = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');

describe('--help', () => {
	it('prints the grouped help screen and exits 0', () => {
		const output = execFileSync(process.execPath, [getCliBinPath(), '--help'], {
			encoding: 'utf-8',
			stdio: 'pipe',
			env: { ...process.env, TASKGRAPH_SKIP_AUTO_UPDATE: '1', COLUMNS: '80' }
		});
		const text = stripAnsi(output);

		expect(text).toContain('Daily workflow');
		expect(text).toContain('Organize');
		expect(text).toMatch(/^ {2}loop {2,}Have Claude Code/m);
		expect(text).toMatch(/^ {2}github <push\|pull\|status\|unlink> {2,}Sync/m);
		expect(text).toContain('taskgraph <command> --help');
		expect(text).toContain('/plugin install taskgraph@taskgraph');
	});
});
