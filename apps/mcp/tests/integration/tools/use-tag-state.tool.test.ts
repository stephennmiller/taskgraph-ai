/**
 * @fileoverview Regression tests for #807: use_tag replied `"switched": true`
 * when state.json couldn't be saved, and a broken state.json silently made
 * master the current tag. Each call goes through the built server.
 *
 * Needs the build (`npm run build`).
 *
 * @integration
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { callMCPTool } from '../../helpers/call-mcp-tool.js';

const repoRoot = path.resolve(__dirname, '../../../../..');

describe('use_tag and an unusable state.json (#807)', () => {
	let testDir: string;
	let statePath: string;

	beforeEach(() => {
		testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-mcp-state-'));
		process.chdir(testDir);
		const cli = `node "${path.join(repoRoot, 'dist', 'taskgraph.js')}"`;
		const env = { ...process.env, TASKGRAPH_SKIP_AUTO_UPDATE: '1' };
		execSync(`${cli} init --yes`, { stdio: 'pipe', env });
		execSync(`${cli} tags add feat`, { stdio: 'pipe', env });
		statePath = path.join(testDir, '.taskgraph', 'state.json');
	});

	afterEach(() => {
		process.chdir(repoRoot);
		fs.rmSync(testDir, { recursive: true, force: true });
	});

	it('replies with an error, not switched: true, when the switch cannot be saved', () => {
		fs.writeFileSync(statePath, '[]');

		expect(() =>
			callMCPTool('use_tag', { name: 'feat', projectRoot: testDir })
		).toThrow(/state\.json does not hold a JSON object.*delete it/);
		expect(fs.readFileSync(statePath, 'utf8')).toBe('[]');
	}, 30000);

	it('replies with an error instead of falling back to master on a broken state.json', () => {
		fs.writeFileSync(statePath, '{"currentTag": "feat",\n<<<<<<< HEAD\n');

		expect(() => callMCPTool('get_tasks', { projectRoot: testDir })).toThrow(
			/Couldn't read .*state\.json.*delete it/
		);
	}, 30000);
});
