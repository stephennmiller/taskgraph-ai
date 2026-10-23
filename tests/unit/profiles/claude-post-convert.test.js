import fs from 'fs';
import os from 'os';
import path from 'path';
import { onPostConvertRulesProfile } from '../../../src/profiles/claude.js';

describe('Claude onPostConvertRulesProfile', () => {
	let projectDir;
	let assetsDir;
	let originalHome;

	beforeEach(() => {
		// Isolate anything that touches the shell config
		originalHome = process.env.HOME;
		process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-home-'));
		projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-project-'));
		assetsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-assets-'));
		fs.writeFileSync(path.join(assetsDir, 'AGENTS.md'), '# guide');
	});

	afterEach(() => {
		fs.rmSync(process.env.HOME, { recursive: true, force: true });
		process.env.HOME = originalHome;
		fs.rmSync(projectDir, { recursive: true, force: true });
		fs.rmSync(assetsDir, { recursive: true, force: true });
	});

	it('does not repeat the add step that convertAllRulesToProfileRules already ran', () => {
		onPostConvertRulesProfile(projectDir, assetsDir);

		expect(fs.existsSync(path.join(projectDir, 'CLAUDE.md'))).toBe(false);
		expect(fs.existsSync(path.join(projectDir, '.taskgraph'))).toBe(false);
	});

	it('leaves an existing .mcp.json alone unless mcp is asked for', () => {
		const file = path.join(projectDir, '.mcp.json');
		const mine = JSON.stringify({
			mcpServers: { tm: { command: 'npx', args: ['x'] } }
		});
		fs.writeFileSync(file, mine);

		onPostConvertRulesProfile(projectDir, assetsDir);

		expect(fs.readFileSync(file, 'utf8')).toBe(mine);
	});

	it('converts an existing .mcp.json to the Claude format with mcp: true', () => {
		fs.writeFileSync(
			path.join(projectDir, '.mcp.json'),
			JSON.stringify({ mcpServers: { tm: { command: 'npx', args: ['x'] } } })
		);

		onPostConvertRulesProfile(projectDir, assetsDir, { mcp: true });

		const config = JSON.parse(
			fs.readFileSync(path.join(projectDir, '.mcp.json'), 'utf8')
		);
		expect(config.mcpServers.tm.type).toBe('stdio');
	});
});
