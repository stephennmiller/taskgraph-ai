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

	it("removes the command files an earlier init wrote and keeps the user's own", () => {
		const tmDir = path.join(projectDir, '.claude', 'commands', 'tm');
		fs.mkdirSync(tmDir, { recursive: true });
		fs.writeFileSync(path.join(tmDir, 'next-task.md'), '# old');
		fs.writeFileSync(path.join(tmDir, 'to-review.md'), '# old');
		fs.writeFileSync(path.join(tmDir, 'my-command.md'), '# mine');

		convertAllRulesToProfileRules(projectDir, claudeProfile);

		expect(fs.readdirSync(tmDir)).toEqual(['my-command.md']);
	});

	it('removes the empty .claude/commands/tm directory', () => {
		const tmDir = path.join(projectDir, '.claude', 'commands', 'tm');
		fs.mkdirSync(tmDir, { recursive: true });
		fs.writeFileSync(path.join(tmDir, 'help.md'), '# old');

		convertAllRulesToProfileRules(projectDir, claudeProfile);

		expect(fs.existsSync(tmDir)).toBe(false);
	});
});
