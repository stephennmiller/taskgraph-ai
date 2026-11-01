import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	symlinkSync,
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

	it('keeps an empty folder it removed nothing from', () => {
		mkdirSync(join(tmDir, 'mine'));

		pruneLegacySlashCommands(projectRoot);

		expect(existsSync(join(tmDir, 'mine'))).toBe(true);
	});

	describe.skipIf(process.platform === 'win32')('links', () => {
		let outside: string;

		beforeEach(() => {
			outside = mkdtempSync(join(tmpdir(), 'tm-outside-'));
			mkdirSync(join(outside, 'empty'));
			writeFileSync(join(outside, 'index.md'), '# mine');
			rmSync(join(projectRoot, '.claude'), { recursive: true });
		});

		afterEach(() => {
			rmSync(outside, { recursive: true, force: true });
		});

		it.each([
			['.claude/commands/tm', ''],
			['.claude/commands', 'tm'],
			['.claude', 'commands/tm']
		])('does not follow a link at %s', (linkPath, below) => {
			// The link leads to a folder whose tm/ is the outside folder's copy
			const target = below ? mkdtempSync(join(outside, 'link-')) : outside;
			if (below) {
				mkdirSync(join(target, below, '..'), { recursive: true });
				symlinkSync(outside, join(target, below));
			}
			mkdirSync(join(projectRoot, linkPath, '..'), { recursive: true });
			symlinkSync(target, join(projectRoot, linkPath));

			expect(pruneLegacySlashCommands(projectRoot).removed).toEqual([]);
			expect(existsSync(join(outside, 'index.md'))).toBe(true);
			expect(existsSync(join(outside, 'empty'))).toBe(true);
		});

		it('removes a link with a legacy name, not what it points at', () => {
			mkdirSync(tmDir, { recursive: true });
			symlinkSync(join(outside, 'index.md'), join(tmDir, 'help.md'));

			pruneLegacySlashCommands(projectRoot);

			expect(existsSync(join(tmDir, 'help.md'))).toBe(false);
			expect(existsSync(join(outside, 'index.md'))).toBe(true);
		});

		it('does not walk a linked folder inside tm/', () => {
			mkdirSync(tmDir, { recursive: true });
			symlinkSync(outside, join(tmDir, 'category'));

			pruneLegacySlashCommands(projectRoot);

			expect(existsSync(join(outside, 'index.md'))).toBe(true);
		});
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
