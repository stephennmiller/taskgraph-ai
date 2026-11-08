import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { getCliBinPath, RM_OPTS } from '../helpers/test-utils.js';

const binPath = getCliBinPath();

// Prints the variable as the CLI process exits
const reportOnExit = `data:text/javascript,process.on('exit',()=>process.stderr.write('NDC='+process.env.NoDefaultCurrentDirectoryInExePath+'\\n'))`;

vi.setConfig({ testTimeout: 60000 });

describe('taskgraph exe search', () => {
	let dir: string;
	afterEach(() => fs.rmSync(dir, RM_OPTS));

	// On Windows, cmd.exe and libuv otherwise run a git.exe or claude.cmd in
	// the project directory before the one on PATH
	test('sets NoDefaultCurrentDirectoryInExePath for the processes it starts', () => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-exe-search-'));
		const env: NodeJS.ProcessEnv = {
			...process.env,
			TASKGRAPH_SKIP_AUTO_UPDATE: '1'
		};
		delete env.NoDefaultCurrentDirectoryInExePath;

		const result = spawnSync(
			process.execPath,
			['--import', reportOnExit, binPath, 'list'],
			{ cwd: dir, encoding: 'utf8', env }
		);

		expect(result.stderr).toContain('NDC=1');
	});
});
