import fs from 'fs';
import os from 'os';
import path from 'path';
import { claudeProfile } from '../../../src/profiles/claude.js';
import { convertAllRulesToProfileRules } from '../../../src/utils/rule-transformer.js';

describe('init --rules claude leaves slash commands to the plugin', () => {
	let projectDir;
	let originalHome;

	beforeEach(() => {
		// Isolate anything that touches the shell config
		originalHome = process.env.HOME;
		process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-home-'));
		projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-project-'));
	});

	afterEach(() => {
		fs.rmSync(process.env.HOME, { recursive: true, force: true });
		process.env.HOME = originalHome;
		fs.rmSync(projectDir, { recursive: true, force: true });
	});

	it('does not configure slash commands on the profile', () => {
		expect(claudeProfile.slashCommands).toBeUndefined();
	});

	it('writes no .claude/commands directory', () => {
		convertAllRulesToProfileRules(projectDir, claudeProfile);

		expect(fs.existsSync(path.join(projectDir, '.claude', 'commands'))).toBe(
			false
		);
	});

	it('still writes the other Claude rule files', () => {
		convertAllRulesToProfileRules(projectDir, claudeProfile);

		expect(fs.existsSync(path.join(projectDir, 'CLAUDE.md'))).toBe(true);
		expect(
			fs.existsSync(path.join(projectDir, '.taskgraph', 'CLAUDE.md'))
		).toBe(true);
	});
});
