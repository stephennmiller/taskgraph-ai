/**
 * @fileoverview Integration test for 'taskgraph --version'
 *
 * The version is injected into the bundle at build time (tsdown `env`). If the
 * build can't read package.json, the binary silently reports "unknown".
 *
 * @integration
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getCliBinPath } from '../../helpers/test-utils.js';

describe('--version', () => {
	it('prints the version from package.json', () => {
		const repoRoot = path.resolve(__dirname, '../../../../..');
		const { version } = JSON.parse(
			fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')
		);

		const output = execFileSync('node', [getCliBinPath(), '--version'], {
			encoding: 'utf8',
			env: { ...process.env, TASKMASTER_SKIP_AUTO_UPDATE: '1' }
		});

		expect(output.trim()).toBe(version);
	});
});
