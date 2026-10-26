/**
 * @fileoverview Integration tests for `validate-dependencies` and
 * `fix-dependencies`, run against the built CLI.
 *
 * @integration
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it
} from 'vitest';
import { createSubtask, createTask, createTasksFile } from '@tm/core/testing';
import {
	copyProject,
	getCliBinPath,
	spawnTimeout
} from '../../helpers/test-utils.js';

describe('dependency commands', () => {
	let dir: string;
	let home: string;

	const run = (args: string[]) =>
		spawnSync('node', [getCliBinPath(), ...args], {
			cwd: dir,
			encoding: 'utf8',
			input: '',
			timeout: 30000,
			env: {
				...process.env,
				HOME: home,
				FORCE_COLOR: '0',
				COLUMNS: '80',
				TASKGRAPH_SKIP_AUTO_UPDATE: '1'
			}
		});

	const tasksFile = () => path.join(dir, '.taskgraph', 'tasks', 'tasks.json');

	/** Set a task's dependencies directly, as a hand edit would */
	const setDependencies = (taskIndex: number, dependencies: unknown[]) => {
		const data = JSON.parse(fs.readFileSync(tasksFile(), 'utf8'));
		data.master.tasks[taskIndex].dependencies = dependencies;
		fs.writeFileSync(tasksFile(), JSON.stringify(data, null, 2));
	};

	// Set the project up once and copy it into each test's folder: every spawn
	// of the built CLI takes seconds on a loaded runner
	let template: string;
	let templateHome: string;

	beforeAll(() => {
		template = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-deps-tpl-'));
		templateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-deps-home-'));
		dir = template;
		home = templateHome;
		expect(run(['init', '--yes', '--no-aliases', '--no-git']).status).toBe(0);
		for (const title of ['Set up the API', 'Add Postgres', 'Sign-in']) {
			expect(
				run(['add-task', `--title=${title}`, `--description=${title}`]).status
			).toBe(0);
		}
	}, 60000);

	afterAll(() => {
		fs.rmSync(template, { recursive: true, force: true });
		fs.rmSync(templateHome, { recursive: true, force: true });
	});

	beforeEach(() => {
		dir = copyProject(template, 'tm-deps-');
		home = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-deps-home-'));
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
		fs.rmSync(home, { recursive: true, force: true });
	});

	it('validate: one line and exit 0 when there are no problems', () => {
		run(['add-dependency', '--id=2', '--depends-on=1']);
		const result = run(['validate-dependencies']);

		expect(result.status).toBe(0);
		expect(result.stdout).toContain(
			'✓ No dependency problems · 3 tasks, 1 dependency'
		);
		expect(result.stdout).not.toContain('╭');
	});

	it('validate: lists a self-dependency once and exits 1', () => {
		setDependencies(1, [99, 2]);
		const result = run(['validate-dependencies']);

		expect(result.status).toBe(1);
		expect(result.stdout).toContain('✗ 2 dependency problems');
		expect(result.stdout).toContain(
			"2  depends on task 99, which doesn't exist"
		);
		expect(result.stdout).toContain('2  depends on itself');
		expect(result.stdout).not.toContain('loop');
		expect(result.stdout).toContain('Run taskgraph fix-dependencies');
	});

	it('fix: removes the self-dependency too, so validate passes after', () => {
		setDependencies(1, [99, 2]);
		const fixed = run(['fix-dependencies']);

		expect(fixed.status).toBe(0);
		expect(fixed.stdout).toContain('✓ Fixed 2 dependency problems');
		expect(fixed.stdout).toContain('2  removed its dependency on itself');
		expect(run(['validate-dependencies']).status).toBe(0);
	});

	it('fix: reports a loop between tasks it leaves, and exits 1', () => {
		// Task 2 waits on 3 and task 3 waits on 2
		setDependencies(1, [3]);
		setDependencies(2, [2]);

		const result = run(['fix-dependencies']);

		expect(result.status).toBe(1);
		expect(result.stdout).toContain('✗ 2 dependency problems');
		expect(result.stdout).toContain('taskgraph remove-dependency');
	});

	it("fix: for a loop it can't break, points at remove-dependency every time", () => {
		// Task 1 waits on its own subtask 1.1, which waits on task 1
		const data = JSON.parse(fs.readFileSync(tasksFile(), 'utf8'));
		data.master.tasks[0].dependencies = ['1.1'];
		data.master.tasks[0].subtasks = [
			{ id: 1, title: 'Sub', status: 'pending', dependencies: ['1'] }
		];
		fs.writeFileSync(tasksFile(), JSON.stringify(data, null, 2));

		for (const result of [
			run(['fix-dependencies']),
			run(['fix-dependencies'])
		]) {
			expect(result.status).toBe(1);
			expect(result.stdout).toContain('taskgraph remove-dependency');
			expect(result.stdout).not.toContain('Run taskgraph fix-dependencies');
		}
	});

	it('validate: lists only the tasks in a loop, and how to break it', () => {
		// 2 and 3 wait on each other; 1 only waits on 2
		setDependencies(0, [2]);
		setDependencies(1, [3]);
		setDependencies(2, [2]);

		const result = run(['validate-dependencies']);

		expect(result.status).toBe(1);
		expect(result.stdout).toContain('✗ 2 dependency problems');
		expect(result.stdout).not.toMatch(/^\s+1\s/m);
		expect(result.stdout).toContain('taskgraph remove-dependency');
		expect(result.stdout).not.toContain('Run taskgraph fix-dependencies');
	});

	it(
		'refuses a loop through a dependency a subtask inherits from its parent (#698)',
		() => {
			// Review repro: task 4 depends on 1.1, then task 1 is made to depend on 4
			fs.writeFileSync(
				tasksFile(),
				JSON.stringify(
					createTasksFile({
						tasks: [
							createTask({
								id: '1',
								title: 't1',
								subtasks: [createSubtask({ id: 1, title: 's1', parentId: '1' })]
							}),
							createTask({
								id: '4',
								title: 't4',
								dependencies: ['1.1']
							})
						]
					}),
					null,
					2
				)
			);

			const added = run(['add-dependency', '--id=1', '--depends-on=4']);

			expect(added.status).toBe(1);
			expect(added.stderr).toContain('would make a loop');
			expect(
				JSON.parse(fs.readFileSync(tasksFile(), 'utf8')).master.tasks[0]
					.dependencies
			).toEqual([]);

			const next = run(['next']);
			expect(next.status).toBe(0);
			expect(next.stdout).toContain('t1');
			expect(next.stdout).not.toContain('blocked by dependencies');

			const validated = run(['validate-dependencies']);
			expect(validated.status).toBe(0);
			expect(validated.stdout).toContain('No dependency problems');

			const why = run(['why', '4']);
			expect(why.status).toBe(0);
			expect(why.stdout).toContain('Blocked by:');
			expect(why.stdout).toContain('1.1');

			// Written straight into the file, the same loop is still a problem,
			// and fix-dependencies leaves it for the user to break
			const data = JSON.parse(fs.readFileSync(tasksFile(), 'utf8'));
			data.master.tasks[0].dependencies = ['4'];
			fs.writeFileSync(tasksFile(), JSON.stringify(data, null, 2));

			const found = run(['validate-dependencies']);
			expect(found.status).toBe(1);
			expect(found.stdout).toContain('is part of a dependency loop');
			expect(found.stdout).toContain('1.1');
			expect(found.stdout).toContain('4');
			expect(found.stdout).not.toContain('Run taskgraph fix-dependencies');

			const fixed = run(['fix-dependencies']);
			expect(fixed.status).toBe(1);
			expect(fixed.stdout).toContain('is part of a dependency loop');
			expect(
				JSON.parse(fs.readFileSync(tasksFile(), 'utf8')).master.tasks[0]
					.dependencies
			).toEqual(['4']);
		},
		spawnTimeout(6)
	);

	it('add: a repeat dependency is one plain line, not a warning', () => {
		run(['add-dependency', '--id=2', '--depends-on=1']);
		const result = run(['add-dependency', '--id=2', '--depends-on=1']);

		expect(result.status).toBe(0);
		expect(result.stdout + result.stderr).toContain(
			'Task 2 already depends on task 1; nothing changed'
		);
		expect(result.stdout + result.stderr).not.toContain('⚠');
	});

	describe('PRD coverage', () => {
		/** Record the PRD section a task came from, as parse-prd does */
		const setSources = (sources: Array<string | undefined>) => {
			const data = JSON.parse(fs.readFileSync(tasksFile(), 'utf8'));
			sources.forEach((source, i) => {
				if (source) {
					data.master.tasks[i].metadata = {
						...data.master.tasks[i].metadata,
						source
					};
				}
			});
			fs.writeFileSync(tasksFile(), JSON.stringify(data, null, 2));
		};

		const writePrd = (markdown: string) => {
			fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
			fs.writeFileSync(path.join(dir, 'docs', 'prd.md'), markdown);
		};

		it('says nothing about PRDs when no task records a section', () => {
			const result = run(['validate-dependencies']);

			expect(result.status).toBe(0);
			expect(result.stdout).not.toContain('PRD');
		});

		it('says every section has a task in one line', () => {
			writePrd('# App\n\n## API\n\n## Database\n\n## Sign-in\n');
			setSources([
				'docs/prd.md#api',
				'docs/prd.md#database',
				'docs/prd.md#sign-in'
			]);
			const result = run(['validate-dependencies']);

			expect(result.status).toBe(0);
			expect(result.stdout).toContain(
				'✓ Every PRD section has a task · 4 sections in docs/prd.md'
			);
		});

		it('lists gaps as warnings without failing the check', () => {
			writePrd('# App\n\n## API\n\n## Database\n\n## Billing\n');
			setSources(['docs/prd.md#api', 'docs/prd.md#postgres']);
			const result = run(['validate-dependencies']);

			expect(result.status).toBe(0);
			expect(result.stdout).toContain('✓ No dependency problems');
			expect(result.stdout).toContain(
				'⚠ 2 of 4 PRD sections have no task · docs/prd.md'
			);
			expect(result.stdout).toMatch(/#database\s+Database/);
			expect(result.stdout).toContain(
				'⚠ 1 task cites a heading docs/prd.md no longer has'
			);
			expect(result.stdout).toMatch(/2\s+#postgres/);
			expect(result.stdout).toContain('⚠ 1 task has no PRD section');
			expect(result.stdout).toMatch(/3\s+Sign-in/);
			for (const line of result.stdout.split('\n')) {
				expect(line.length).toBeLessThanOrEqual(80);
			}
		});

		it('show names the section a task came from', () => {
			writePrd('# App\n\n## API\n');
			setSources(['docs/prd.md#api']);
			const result = run(['show', '1']);

			expect(result.status).toBe(0);
			expect(result.stdout).toContain('PRD · docs/prd.md#api\n  ## API');
		});
	});
});
