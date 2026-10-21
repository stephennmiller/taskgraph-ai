import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	LEGACY_COMMAND_NAMES,
	pruneLegacySlashCommands
} from './legacy-commands.js';

const previousName = ['task', 'master'].join('');

describe('pruneLegacySlashCommands', () => {
	let projectRoot: string;
	let tmDir: string;

	const write = (relative: string) => {
		const file = join(tmDir, relative);
		mkdirSync(join(file, '..'), { recursive: true });
		writeFileSync(file, '# command');
	};

	beforeEach(() => {
		projectRoot = mkdtempSync(join(tmpdir(), 'tm-prune-'));
		tmDir = join(projectRoot, '.claude', 'commands', 'tm');
		mkdirSync(tmDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(projectRoot, { recursive: true, force: true });
	});

	it('removes the files init wrote, current and renamed names alike', () => {
		write('next-task.md');
		write('to-review.md');
		write('update-single-task.md');
		write(`quick-install-${previousName}.md`);

		const result = pruneLegacySlashCommands(projectRoot);

		expect(result.removed.sort()).toEqual([
			'next-task.md',
			`quick-install-${previousName}.md`,
			'to-review.md',
			'update-single-task.md'
		]);
	});

	it('keeps files the user added', () => {
		write('next-task.md');
		write('my-own-command.md');
		write('notes.txt');

		pruneLegacySlashCommands(projectRoot);

		expect(readdirSync(tmDir).sort()).toEqual([
			'my-own-command.md',
			'notes.txt'
		]);
	});

	it('removes the directory when nothing is left', () => {
		write('next-task.md');
		write('help.md');

		pruneLegacySlashCommands(projectRoot);

		expect(existsSync(tmDir)).toBe(false);
	});

	it('leaves the other .claude/commands entries alone', () => {
		write('next-task.md');
		mkdirSync(join(projectRoot, '.claude', 'commands', 'mine'), {
			recursive: true
		});
		writeFileSync(
			join(projectRoot, '.claude', 'commands', 'mine', 'a.md'),
			'x'
		);

		pruneLegacySlashCommands(projectRoot);

		expect(
			existsSync(join(projectRoot, '.claude', 'commands', 'mine', 'a.md'))
		).toBe(true);
	});

	it('prunes the old nested layout and its emptied category folders', () => {
		write('list/list-tasks.md');
		write('set-status/to-done.md');
		write('index.md');

		pruneLegacySlashCommands(projectRoot);

		expect(existsSync(tmDir)).toBe(false);
	});

	it('keeps a nested folder that still holds a user file', () => {
		write('list/list-tasks.md');
		write('list/my-list.md');

		pruneLegacySlashCommands(projectRoot);

		expect(readdirSync(join(tmDir, 'list'))).toEqual(['my-list.md']);
	});

	it('does nothing when the project has no .claude/commands/tm', () => {
		rmSync(tmDir, { recursive: true });

		expect(pruneLegacySlashCommands(projectRoot).removed).toEqual([]);
	});

	it('lists every command name the previous init wrote', () => {
		for (const name of [
			'help',
			'tm-main',
			'to-pending',
			'remove-all-subtasks'
		]) {
			expect(LEGACY_COMMAND_NAMES).toContain(name);
		}
		expect(new Set(LEGACY_COMMAND_NAMES).size).toBe(
			LEGACY_COMMAND_NAMES.length
		);
	});
});
