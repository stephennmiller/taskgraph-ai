/**
 * @fileoverview The server sets NoDefaultCurrentDirectoryInExePath for every
 * process it starts. On Windows, cmd.exe and libuv otherwise run a git.exe or
 * claude.cmd sitting in the project directory before the one on PATH.
 *
 * Needs the build (`npm run build`).
 *
 * @integration
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../..');
const serverBin = path.join(repoRoot, 'dist', 'mcp-server.js');

// Prints the variable as the server process exits
const reportOnExit = `data:text/javascript,process.on('exit',()=>process.stderr.write('NDC='+process.env.NoDefaultCurrentDirectoryInExePath+'\\n'))`;

describe('MCP server exe search', () => {
	let dir: string | undefined;
	afterEach(() => {
		if (dir) fs.rmSync(dir, { recursive: true, force: true });
	});

	it('sets NoDefaultCurrentDirectoryInExePath for the processes it starts', () => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-mcp-exe-search-'));
		const { NoDefaultCurrentDirectoryInExePath: _unset, ...env } = process.env;

		// stdin closes at once, so the server stops after starting
		const result = spawnSync(
			process.execPath,
			['--import', reportOnExit, serverBin],
			{ cwd: dir, encoding: 'utf8', input: '', env, timeout: 30000 }
		);

		expect(result.stderr).toContain('NDC=1');
	});
});
