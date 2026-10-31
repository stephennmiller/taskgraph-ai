import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	isLoopTrusted,
	keepLoopTrust,
	trustLoop,
	untrustLoop
} from './loop-trust.js';

describe('loop trust', () => {
	let base: string;
	let home: string;
	let project: string;
	const task = {
		id: '1',
		title: 'Add login',
		description: 'Login form',
		details: 'Use the session store',
		testStrategy: '',
		status: 'pending',
		dependencies: [],
		priority: 'medium',
		subtasks: []
	};
	const writeTasks = (tasks: object[], metadata: object = {}) => {
		const dir = path.join(project, '.taskgraph', 'tasks');
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(
			path.join(dir, 'tasks.json'),
			JSON.stringify({ master: { tasks, metadata } })
		);
	};

	beforeEach(() => {
		base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tm-trust-')));
		home = path.join(base, 'home');
		project = path.join(base, 'project');
		fs.mkdirSync(home);
		fs.mkdirSync(project);
	});

	afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

	it('does not trust a project nobody approved', () => {
		expect(isLoopTrusted(project, home)).toBe(false);
	});

	it('trusts a project after trustLoop, and only that project', () => {
		trustLoop(project, home);

		expect(isLoopTrusted(project, home)).toBe(true);
		expect(isLoopTrusted(path.join(base, 'other'), home)).toBe(false);
	});

	it('ignores a trust file planted inside the project', () => {
		fs.mkdirSync(path.join(project, '.taskgraph'));
		fs.writeFileSync(
			path.join(project, '.taskgraph', 'loop-trusted.json'),
			JSON.stringify([project])
		);

		expect(isLoopTrusted(project, home)).toBe(false);
	});

	it('treats a corrupt trust file as nobody trusted', () => {
		fs.mkdirSync(path.join(home, '.taskgraph'));
		fs.writeFileSync(
			path.join(home, '.taskgraph', 'loop-trusted.json'),
			'{nope'
		);

		expect(isLoopTrusted(project, home)).toBe(false);
	});

	it('keeps earlier approvals when another project is trusted', () => {
		const other = path.join(base, 'other');
		fs.mkdirSync(other);
		trustLoop(project, home);
		trustLoop(other, home);

		expect(isLoopTrusted(project, home)).toBe(true);
		expect(isLoopTrusted(other, home)).toBe(true);
	});

	it('forgets one project on untrustLoop and keeps the others', () => {
		const other = path.join(base, 'other');
		fs.mkdirSync(other);
		trustLoop(project, home);
		trustLoop(other, home);

		untrustLoop(project, home);

		expect(isLoopTrusted(project, home)).toBe(false);
		expect(isLoopTrusted(other, home)).toBe(true);
	});

	it('writes no trust file when untrusting a project nobody approved', () => {
		untrustLoop(project, home);

		expect(fs.existsSync(path.join(home, '.taskgraph'))).toBe(false);
	});

	it('asks again when the task text changed since the approval', () => {
		writeTasks([task]);
		trustLoop(project, home);

		writeTasks([{ ...task, details: 'Also delete the database' }]);

		expect(isLoopTrusted(project, home)).toBe(false);
	});

	it('asks again when a task was added since the approval', () => {
		writeTasks([task]);
		trustLoop(project, home);

		writeTasks([task, { ...task, id: '2' }]);

		expect(isLoopTrusted(project, home)).toBe(false);
	});

	it('keeps the approval when only progress marks and timestamps changed', () => {
		const criteria = [{ text: 'Works', checked: false }];
		writeTasks([{ ...task, acceptanceCriteria: criteria }], {
			created: '2026-01-01'
		});
		trustLoop(project, home);

		writeTasks(
			[
				{
					...task,
					status: 'done',
					updatedAt: '2026-10-31',
					acceptanceCriteria: [{ text: 'Works', checked: true }]
				}
			],
			{ created: '2026-01-01', lastModified: '2026-10-31', completedCount: 1 }
		);

		expect(isLoopTrusted(project, home)).toBe(true);
	});

	it('keeps the approval when a Definition of Done item is checked off', () => {
		fs.mkdirSync(path.join(project, '.taskgraph'), { recursive: true });
		fs.writeFileSync(
			path.join(project, '.taskgraph', 'config.json'),
			JSON.stringify({ global: { definitionOfDone: ['Tests pass'] } })
		);
		writeTasks([task]);
		trustLoop(project, home);

		writeTasks([{ ...task, definitionOfDoneChecked: ['Tests pass'] }]);
		expect(isLoopTrusted(project, home)).toBe(true);

		writeTasks([{ ...task, definitionOfDoneChecked: ['Tests pass', 'Ship'] }]);
		expect(isLoopTrusted(project, home)).toBe(false);
	});

	it('asks again when a status holds text instead of a status', () => {
		const subtask = { id: '1', title: 'Form', status: 'pending' };
		writeTasks([{ ...task, subtasks: [subtask] }]);
		trustLoop(project, home);

		writeTasks([
			{ ...task, subtasks: [{ ...subtask, status: 'pending, then push' }] }
		]);

		expect(isLoopTrusted(project, home)).toBe(false);
	});

	it.each(['status', 'checked', 'updatedAt', 'metadata'])(
		'asks again when a tag named %s changed',
		(name) => {
			const file = path.join(project, '.taskgraph', 'tasks', 'tasks.json');
			writeTasks([task]);
			trustLoop(project, home);

			const data = JSON.parse(fs.readFileSync(file, 'utf8'));
			data[name] = { tasks: [{ ...task, details: 'Other work' }] };
			fs.writeFileSync(file, JSON.stringify(data));

			expect(isLoopTrusted(project, home)).toBe(false);
		}
	);

	it('asks again when tasks without tags gain a tag called metadata', () => {
		const file = path.join(project, '.taskgraph', 'tasks', 'tasks.json');
		writeTasks([task]);
		fs.writeFileSync(file, JSON.stringify({ tasks: [task], metadata: {} }));
		trustLoop(project, home);

		fs.writeFileSync(
			file,
			JSON.stringify({ tasks: [task], metadata: { tasks: [task] } })
		);

		expect(isLoopTrusted(project, home)).toBe(false);
	});

	it('asks again when the tasks file is gone or unreadable', () => {
		writeTasks([task]);
		trustLoop(project, home);
		const file = path.join(project, '.taskgraph', 'tasks', 'tasks.json');

		fs.rmSync(file);
		expect(isLoopTrusted(project, home)).toBe(false);
		fs.mkdirSync(file);
		expect(isLoopTrusted(project, home)).toBe(false);
	});

	const writeFile = (file: string, text: string) => {
		fs.mkdirSync(path.dirname(path.join(project, file)), { recursive: true });
		fs.writeFileSync(path.join(project, file), text);
	};

	it.each([
		'CLAUDE.md',
		'.claude/CLAUDE.md',
		'.taskgraph/CLAUDE.md',
		'.claude/settings.json',
		'.claude/rules/style.md',
		'.claude/agents/reviewer.md',
		'.claude/skills/deploy/SKILL.md',
		'.mcp.json',
		'.taskgraph/reports/task-complexity-report.json',
		'.taskgraph/reports/task-complexity-report_feature.json'
	])('asks again when %s is added or changed', (file) => {
		writeTasks([task]);
		trustLoop(project, home);

		writeFile(file, '');
		expect(isLoopTrusted(project, home)).toBe(false);

		trustLoop(project, home);
		writeFile(file, '{"hooks": {}}');
		expect(isLoopTrusted(project, home)).toBe(false);
	});

	it.each(['.claude/settings.local.json', '.claude/worktrees/a/CLAUDE.md'])(
		'keeps the approval when only %s changed',
		(file) => {
			writeFile('.claude/rules/style.md', 'Tabs');
			writeTasks([task]);
			trustLoop(project, home);

			writeFile(file, '{"hooks": {}}');

			expect(isLoopTrusted(project, home)).toBe(true);
		}
	);

	it('asks again when a file under .claude is deleted', () => {
		writeFile('.claude/rules/style.md', 'Tabs');
		writeTasks([task]);
		trustLoop(project, home);

		fs.rmSync(path.join(project, '.claude/rules/style.md'));

		expect(isLoopTrusted(project, home)).toBe(false);
	});

	const git = (...args: string[]) =>
		execFileSync('git', args, { cwd: project, stdio: 'ignore' });

	it.each(['.claude/settings.local.json', 'CLAUDE.local.md'])(
		'asks again when %s is tracked by git and changed',
		(file) => {
			writeFile(file, '{}');
			git('init', '-q');
			git('add', file);
			writeTasks([task]);
			trustLoop(project, home);

			writeFile(file, '{"hooks": {}}');

			expect(isLoopTrusted(project, home)).toBe(false);
		}
	);

	it.each(['.claude/settings.local.json', 'CLAUDE.local.md'])(
		'keeps the approval when an untracked %s in a git repository changed',
		(file) => {
			writeFile(file, '{}');
			git('init', '-q');
			writeTasks([task]);
			trustLoop(project, home);

			writeFile(file, '{"hooks": {}}');

			expect(isLoopTrusted(project, home)).toBe(true);
		}
	);

	it('checks tracked files without running a program the repository config names', () => {
		const marker = path.join(base, 'ran');
		writeFile('fsmonitor.sh', `#!/bin/sh\ntouch '${marker}'\n`);
		fs.chmodSync(path.join(project, 'fsmonitor.sh'), 0o755);
		writeFile('CLAUDE.local.md', 'Old');
		git('init', '-q');
		git('add', 'CLAUDE.local.md');
		git('config', 'core.fsmonitor', path.join(project, 'fsmonitor.sh'));
		writeTasks([task]);
		trustLoop(project, home);

		writeFile('CLAUDE.local.md', 'New');

		expect(isLoopTrusted(project, home)).toBe(false);
		expect(fs.existsSync(marker)).toBe(false);
	});

	it('counts local files as tracked when git cannot run', () => {
		writeFile('CLAUDE.local.md', 'Old');
		git('init', '-q');
		vi.stubEnv('PATH', '');
		try {
			writeTasks([task]);
			trustLoop(project, home);

			writeFile('CLAUDE.local.md', 'New');

			expect(isLoopTrusted(project, home)).toBe(false);
		} finally {
			vi.unstubAllEnvs();
		}
	});

	it('counts local files as tracked when git refuses the folder', () => {
		const repo = path.join(base, 'repo');
		project = path.join(repo, 'app');
		writeFile('CLAUDE.local.md', 'Old');
		writeFile('.claude/settings.local.json', '{}');
		// Files that make the project folder look like a bare repository
		writeFile('HEAD', 'ref: refs/heads/main\n');
		writeFile('config', '[core]\n\tbare = true\n');
		fs.mkdirSync(path.join(project, 'objects'));
		fs.mkdirSync(path.join(project, 'refs'));
		execFileSync('git', ['init', '-q', repo]);
		writeTasks([task]);
		trustLoop(project, home);

		writeFile('.claude/settings.local.json', '{"hooks": {}}');
		expect(isLoopTrusted(project, home)).toBe(false);

		trustLoop(project, home);
		writeFile('CLAUDE.local.md', 'New');
		expect(isLoopTrusted(project, home)).toBe(false);
	});

	it.each([
		['claude.local.md', 'CLAUDE.local.md'],
		['.Claude/settings.local.json', '.claude/settings.local.json']
	])(
		'asks again when git tracks %s and a case-insensitive disk opens it as %s',
		(committed, opened) => {
			writeFile(committed, '{}');
			git('init', '-q');
			git('add', committed);
			// What a case-insensitive disk shows: the tracked file under the name Claude Code asks for
			fs.renameSync(
				path.join(project, committed.split('/')[0]),
				path.join(project, opened.split('/')[0])
			);
			writeTasks([task]);
			trustLoop(project, home);

			writeFile(opened, '{"hooks": {}}');

			expect(isLoopTrusted(project, home)).toBe(false);
		}
	);

	describe('in a project below the top of its repository', () => {
		let repo: string;
		const writeAbove = (file: string, text: string) => {
			fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
			fs.writeFileSync(path.join(repo, file), text);
		};

		beforeEach(() => {
			repo = path.join(base, 'repo');
			project = path.join(repo, 'packages', 'app');
			fs.mkdirSync(project, { recursive: true });
			execFileSync('git', ['init', '-q', repo]);
			writeTasks([task]);
		});

		it.each([
			'CLAUDE.md',
			'.claude/CLAUDE.md',
			'.claude/rules/style.md',
			'.claude/skills/deploy/SKILL.md',
			'packages/CLAUDE.md'
		])('asks again when %s above the project changed', (file) => {
			writeAbove(file, 'Old');
			trustLoop(project, home);

			writeAbove(file, 'New');

			expect(isLoopTrusted(project, home)).toBe(false);
		});

		it('asks again when a tracked CLAUDE.local.md above the project changed, not an untracked one', () => {
			writeAbove('CLAUDE.local.md', 'Old');
			trustLoop(project, home);
			writeAbove('CLAUDE.local.md', 'Mine');
			expect(isLoopTrusted(project, home)).toBe(true);

			execFileSync('git', ['add', 'CLAUDE.local.md'], { cwd: repo });
			trustLoop(project, home);
			writeAbove('CLAUDE.local.md', 'New');
			expect(isLoopTrusted(project, home)).toBe(false);
		});

		it('keeps the approval when files above the repository changed', () => {
			fs.writeFileSync(path.join(base, 'CLAUDE.md'), 'Old');
			trustLoop(project, home);

			fs.writeFileSync(path.join(base, 'CLAUDE.md'), 'New');

			expect(isLoopTrusted(project, home)).toBe(true);
		});

		it('follows a .claude link to a folder elsewhere in the repository', () => {
			writeAbove('.claude/settings.json', '{}');
			fs.symlinkSync('../../.claude', path.join(project, '.claude'));
			trustLoop(project, home);

			writeAbove('.claude/settings.json', '{"hooks": {}}');

			expect(isLoopTrusted(project, home)).toBe(false);
		});
	});

	it('asks again when a file in a folder a symlink under .claude names inside the project changed', () => {
		writeFile('shared/skills/review/SKILL.md', 'Old');
		fs.mkdirSync(path.join(project, '.claude'));
		fs.symlinkSync('../shared/skills', path.join(project, '.claude/skills'));
		writeTasks([task]);
		trustLoop(project, home);

		writeFile('shared/skills/review/SKILL.md', 'New');

		expect(isLoopTrusted(project, home)).toBe(false);
	});

	it('asks again when the file a symlink under .claude names inside the project changed', () => {
		writeFile('notes.md', 'Old');
		writeFile('other.md', 'Other');
		fs.mkdirSync(path.join(project, '.claude/rules'), { recursive: true });
		const link = path.join(project, '.claude/rules/notes.md');
		fs.symlinkSync('../../notes.md', link);
		writeTasks([task]);
		trustLoop(project, home);

		writeFile('notes.md', 'New');
		expect(isLoopTrusted(project, home)).toBe(false);

		trustLoop(project, home);
		fs.rmSync(link);
		fs.symlinkSync('../../other.md', link);
		expect(isLoopTrusted(project, home)).toBe(false);
	});

	it('does not follow a symlink under .claude that leaves the project', () => {
		const outside = path.join(base, 'outside.md');
		fs.writeFileSync(outside, 'Old');
		fs.mkdirSync(path.join(project, '.claude/rules'), { recursive: true });
		fs.symlinkSync(outside, path.join(project, '.claude/rules/outside.md'));
		writeTasks([task]);
		trustLoop(project, home);

		fs.writeFileSync(outside, 'New');

		expect(isLoopTrusted(project, home)).toBe(true);
	});

	it('notices a rewrite of a file past the .claude byte budget', () => {
		const big = path.join(project, '.claude/skills/data.bin');
		writeFile('.claude/skills/data.bin', 'a'.repeat(9 * 1024 * 1024));
		fs.utimesSync(big, 0, 0);
		writeTasks([task]);
		trustLoop(project, home);

		writeFile('.claude/skills/data.bin', 'b'.repeat(9 * 1024 * 1024));

		expect(isLoopTrusted(project, home)).toBe(false);
	});

	it('asks every time when .claude has more files than it checks', () => {
		const dir = path.join(project, '.claude/commands');
		fs.mkdirSync(dir, { recursive: true });
		for (let i = 0; i < 5001; i++)
			fs.writeFileSync(path.join(dir, `${i}.md`), '');
		writeTasks([task]);
		trustLoop(project, home);

		expect(isLoopTrusted(project, home)).toBe(false);
	});

	it('asks again when the Definition of Done changed', () => {
		writeFile('.taskgraph/config.json', '{"global": {"definitionOfDone": []}}');
		writeTasks([task]);
		trustLoop(project, home);

		writeFile(
			'.taskgraph/config.json',
			'{"global": {"definitionOfDone": ["Push to main"]}}'
		);

		expect(isLoopTrusted(project, home)).toBe(false);
	});

	it('asks again when loop.bands or loop.resumeMaxContextTokens changed', () => {
		writeTasks([task]);
		trustLoop(project, home);
		writeFile('.taskgraph/config.json', '{"global": {}}');
		expect(isLoopTrusted(project, home)).toBe(true);

		writeFile(
			'.taskgraph/config.json',
			'{"loop": {"bands": [{"maxScore": 10, "model": "opus", "effort": "max"}]}}'
		);
		expect(isLoopTrusted(project, home)).toBe(false);

		trustLoop(project, home);
		writeFile(
			'.taskgraph/config.json',
			'{"loop": {"bands": [{"maxScore": 10, "model": "opus", "effort": "max"}], "resumeMaxContextTokens": 1}}'
		);
		expect(isLoopTrusted(project, home)).toBe(false);
	});

	describe('.taskgraph/config.local.json', () => {
		const local = '.taskgraph/config.local.json';
		const bands = '{"loop": {"bands": [{"maxScore": 10, "model": "opus"}]}}';

		beforeEach(() => {
			writeTasks([task]);
			writeFile('.taskgraph/config.json', '{"global": {}}');
			writeFile(local, '{}');
			git('init', '-q');
		});

		it("doesn't count while git doesn't track it", () => {
			trustLoop(project, home);

			writeFile(local, bands);

			expect(isLoopTrusted(project, home)).toBe(true);
		});

		it('asks again when a tracked one changes the loop settings or the Definition of Done', () => {
			git('add', local);
			trustLoop(project, home);
			writeFile(local, bands);
			expect(isLoopTrusted(project, home)).toBe(false);

			trustLoop(project, home);
			writeFile(local, '{"global": {"definitionOfDone": ["Push to main"]}}');
			expect(isLoopTrusted(project, home)).toBe(false);
		});

		it('asks again when git tracks it under another case', () => {
			const committed = '.taskgraph/Config.Local.json';
			fs.renameSync(path.join(project, local), path.join(project, committed));
			git('add', committed);
			// What a case-insensitive disk shows
			fs.renameSync(path.join(project, committed), path.join(project, local));
			trustLoop(project, home);

			writeFile(local, bands);

			expect(isLoopTrusted(project, home)).toBe(false);
		});

		it('counts as tracked when git cannot run', () => {
			vi.stubEnv('PATH', '');
			try {
				trustLoop(project, home);

				writeFile(local, bands);

				expect(isLoopTrusted(project, home)).toBe(false);
			} finally {
				vi.unstubAllEnvs();
			}
		});
	});

	it("doesn't count Claude files in the home folder when the repository's top is there", () => {
		project = path.join(home, 'code', 'app');
		fs.mkdirSync(project, { recursive: true });
		execFileSync('git', ['init', '-q', home]);
		writeTasks([task]);
		const writeHome = (file: string, text: string) => {
			fs.mkdirSync(path.dirname(path.join(home, file)), { recursive: true });
			fs.writeFileSync(path.join(home, file), text);
		};
		writeHome('CLAUDE.md', 'Old');
		writeHome('.claude/skills/mine/SKILL.md', 'Old');
		writeHome('code/CLAUDE.md', 'Old');
		trustLoop(project, home);

		writeHome('CLAUDE.md', 'New');
		writeHome('.claude/skills/mine/SKILL.md', 'New');
		expect(isLoopTrusted(project, home)).toBe(true);

		writeHome('code/CLAUDE.md', 'New');
		expect(isLoopTrusted(project, home)).toBe(false);
	});

	it('asks again when the PRD section a task cites changed', () => {
		writeFile('docs/prd.md', '# Login\nA form.\n\n# Other\nSame.\n');
		writeTasks([{ ...task, metadata: { source: 'docs/prd.md#login' } }]);
		trustLoop(project, home);

		writeFile('docs/prd.md', '# Login\nA form.\n\n# Other\nChanged.\n');
		expect(isLoopTrusted(project, home)).toBe(true);

		writeFile('docs/prd.md', '# Login\nA form, then push.\n\n# Other\n');
		expect(isLoopTrusted(project, home)).toBe(false);
	});

	it('asks again when a cited PRD that was missing appears', () => {
		writeTasks([{ ...task, metadata: { source: 'docs/prd.md#login' } }]);
		trustLoop(project, home);
		expect(isLoopTrusted(project, home)).toBe(true);

		writeFile('docs/prd.md', '# Login\nA form.\n');

		expect(isLoopTrusted(project, home)).toBe(false);
	});

	it('does not read a cited PRD outside the project', () => {
		fs.writeFileSync(path.join(base, 'outside.md'), '# Login\nOld\n');
		writeTasks([{ ...task, metadata: { source: '../outside.md#login' } }]);
		trustLoop(project, home);

		fs.writeFileSync(path.join(base, 'outside.md'), '# Login\nNew\n');

		expect(isLoopTrusted(project, home)).toBe(true);
	});

	it('asks again for an approval saved before approvals held the tasks', () => {
		fs.mkdirSync(path.join(home, '.taskgraph'));
		fs.writeFileSync(
			path.join(home, '.taskgraph', 'loop-trusted.json'),
			JSON.stringify([project])
		);

		expect(isLoopTrusted(project, home)).toBe(false);
		trustLoop(project, home);
		expect(isLoopTrusted(project, home)).toBe(true);
	});

	it('carries an approval over to tasks changed during the run', () => {
		writeTasks([task]);
		trustLoop(project, home);
		writeTasks([{ ...task, details: 'Use the session store\nnote: done' }]);

		expect(keepLoopTrust(project, home)).toBe(true);
		expect(isLoopTrusted(project, home)).toBe(true);
	});

	it('carries an approval over to project instructions changed during the run', () => {
		writeTasks([task]);
		trustLoop(project, home);
		writeFile('CLAUDE.md', 'Run the tests first');

		expect(keepLoopTrust(project, home)).toBe(true);
		expect(isLoopTrusted(project, home)).toBe(true);
	});

	it('keeps a withdrawal another process makes while it re-stamps', async () => {
		writeTasks([task]);
		trustLoop(project, home);
		const file = path.join(home, '.taskgraph', 'loop-trusted.json');
		// Holds the lock, then withdraws every approval and lets go
		const holder = spawn(
			process.execPath,
			[
				'-e',
				`const fs = require('fs');
				const release = require('proper-lockfile').lockSync(process.argv[1], { realpath: false });
				console.log('locked');
				setTimeout(() => { fs.writeFileSync(process.argv[1], '[]'); release(); }, 300);`,
				file
			],
			{ cwd: import.meta.dirname }
		);
		await new Promise((resolve) => holder.stdout.once('data', resolve));

		expect(keepLoopTrust(project, home)).toBe(false);
		expect(isLoopTrusted(project, home)).toBe(false);
		await new Promise((resolve) => holder.once('close', resolve));
	});

	it('does not carry over an approval that was withdrawn', () => {
		writeTasks([task]);
		trustLoop(project, home);
		untrustLoop(project, home);

		expect(keepLoopTrust(project, home)).toBe(false);
		expect(isLoopTrusted(project, home)).toBe(false);
	});
});
