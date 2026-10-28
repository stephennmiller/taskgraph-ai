import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const binPath = path.join(__dirname, '..', '..', '..', 'dist', 'taskgraph.js');

// Prints the variable as the CLI process exits
const reportOnExit = `data:text/javascript,process.on('exit',()=>process.stderr.write('NDC='+process.env.NoDefaultCurrentDirectoryInExePath+'\\n'))`;

vi.setConfig({ testTimeout: 60000 });

describe('taskgraph exe search', () => {
	let dir;
	afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

	// On Windows, cmd.exe and libuv otherwise run a git.exe or claude.cmd in
	// the project directory before the one on PATH
	test('sets NoDefaultCurrentDirectoryInExePath for the processes it starts', () => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-exe-search-'));
		const env = { ...process.env, TASKGRAPH_SKIP_AUTO_UPDATE: '1' };
		delete env.NoDefaultCurrentDirectoryInExePath;

		const result = spawnSync(
			process.execPath,
			['--import', reportOnExit, binPath, 'list'],
			{ cwd: dir, encoding: 'utf8', env }
		);

		expect(result.stderr).toContain('NDC=1');
	});
});
