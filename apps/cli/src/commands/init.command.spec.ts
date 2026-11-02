/**
 * @fileoverview `init --help`: the title, the groups, and the flags that
 * nothing reads (#927). Behavior of the flags that remain is covered by the
 * init integration tests.
 */

import { UPSTREAM_IMPORT_FLAG } from '@tm/core';
import { describe, expect, it } from 'vitest';
import { InitCommand } from './init.command.js';

const help = () =>
	new InitCommand().helpInformation().replace(/\u001b\[[0-9;]*m/g, '');

describe('init --help', () => {
	it('uses the top-level title and groups the flags', () => {
		const text = help();

		expect(text).toContain('Set up TaskGraph in this project');
		expect(text).not.toContain('Initialize a new project');
		const tasks = text.indexOf('Tasks:');
		const git = text.indexOf('Git:');
		const claude = text.indexOf('Claude Code:');
		const project = text.indexOf('Project:');
		expect(tasks).toBeGreaterThan(0);
		expect(git).toBeGreaterThan(tasks);
		expect(claude).toBeGreaterThan(git);
		expect(project).toBeGreaterThan(claude);
		expect(text).toContain('Keep tasks in Git');
		expect(text).toContain('Keep tasks out of Git');
		expect(text).not.toContain('No Git storage');
		expect(text).toContain('-h, --help');
		expect(text).not.toMatch(/^Options:/m);
	});

	it('leaves out the flags nothing reads', () => {
		const text = help();

		expect(text).not.toContain('skip-install');
		expect(text).not.toContain('--author');
		expect(text).not.toContain('--version');
		expect(text).not.toMatch(/-v,/);
		// The flags that do something stay
		expect(text).toContain('--yes');
		expect(text).toContain('--git-tasks');
		expect(text).toContain('--no-git-tasks');
		expect(text).toContain('--merge-driver');
		expect(text).toContain(UPSTREAM_IMPORT_FLAG);
		expect(text).toContain('--dry-run');
	});
});
