/**
 * @fileoverview doctor's data checks on real project folders: each file that
 * doesn't parse is named, each broken task rule is reported, and the repair
 * leaves a second check clean without touching a file it couldn't read.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkDataFiles, repairTasks } from './doctor-data.js';
import { type CommandRunner, runDoctor } from './doctor.js';

let root: string;

const TASKS = '.taskgraph/tasks/tasks.json';
const write = (file: string, content: unknown) =>
	fs.writeFileSync(
		path.join(root, file),
		typeof content === 'string' ? content : JSON.stringify(content, null, 2)
	);
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

const task = (id: unknown, fields: Record<string, unknown> = {}) => ({
	id,
	title: `Task ${id}`,
	description: '',
	status: 'pending',
	priority: 'medium',
	dependencies: [],
	subtasks: [],
	...fields
});
const sub = (id: string, status: string) => ({
	id,
	title: `Sub ${id}`,
	status
});

const kinds = () =>
	checkDataFiles(root).tasks?.findings.map((f) => `${f.kind} ${f.taskId}`);

const noClaude: CommandRunner = async () => null;
const doctor = (fix = false) =>
	runDoctor({ projectPath: root, run: noClaude, bundledClaude: null, fix });
const tasksCheck = async (fix = false) =>
	(await doctor(fix)).checks.find((check) => check.name === 'tasks');

beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-doctor-data-'));
	fs.mkdirSync(path.join(root, '.taskgraph', 'tasks'), { recursive: true });
	write('.taskgraph/config.json', {});
	write(TASKS, { master: { tasks: [task('1'), task('2')], metadata: {} } });
});

afterEach(() => {
	fs.rmSync(root, { recursive: true, force: true });
});

describe('data files', () => {
	it('passes a healthy project, counting the files that exist', () => {
		const report = checkDataFiles(root);

		expect(report.unreadable).toEqual([]);
		expect(report.read).toBe(2);
		expect(report.tasks).toEqual({ taskCount: 2, tagCount: 1, findings: [] });
	});

	it('names a conflict-marked config.json and the line of the marker', async () => {
		write(
			'.taskgraph/config.json',
			'{\n  "global": {\n<<<<<<< HEAD\n    "a": 1\n=======\n    "a": 2\n>>>>>>> x\n  }\n}\n'
		);

		const report = await doctor();

		expect(report.ok).toBe(false);
		expect(
			report.checks.find((check) => check.name === 'data-files')
		).toMatchObject({
			status: 'fail',
			problem: 'invalid',
			findings: [
				{
					kind: 'unreadable-file',
					file: '.taskgraph/config.json',
					line: 3,
					message: '.taskgraph/config.json has a git conflict marker on line 3'
				}
			]
		});
	});

	it.each([
		['.taskgraph/config.local.json', '{\n  "a": 1,\n  "b" 2\n}', 3],
		['.taskgraph/state.json', '{\n  "currentTag": "master"', 2]
	])(
		'names %s when it is not valid JSON, with the line',
		(file, text, line) => {
			write(file, text);

			expect(checkDataFiles(root).unreadable).toMatchObject([
				{ file, line, message: `${file} isn't valid JSON (line ${line})` }
			]);
		}
	);

	it('names the file without a line when Node gives no position', () => {
		write('.taskgraph/tasks/archive.json', '{"master": }');

		expect(checkDataFiles(root).unreadable).toMatchObject([
			{ message: ".taskgraph/tasks/archive.json isn't valid JSON" }
		]);
	});

	it('reports a tasks.json that holds a list, and skips the task checks', async () => {
		write(TASKS, '[]');

		expect(checkDataFiles(root).unreadable[0].message).toBe(
			`${TASKS} doesn't hold a JSON object`
		);
		expect(await tasksCheck()).toEqual({ name: 'tasks', status: 'skip' });
	});

	it('takes a missing or empty file as fine', () => {
		write('.taskgraph/state.json', '');
		fs.rmSync(path.join(root, TASKS));

		expect(checkDataFiles(root)).toEqual({
			read: 1,
			unreadable: [],
			tasks: null
		});
	});
});

describe('task rules, in every tag', () => {
	it('reports an unknown status and priority, on tasks and subtasks', () => {
		write(TASKS, {
			master: {
				tasks: [
					task('1', { status: 'finished' }),
					task('2', { priority: 'urgent', subtasks: [sub('1', 'wip')] })
				]
			}
		});

		expect(kinds()).toEqual([
			'unknown-status 1',
			'unknown-priority 2',
			'unknown-status 2.1'
		]);
		expect(checkDataFiles(root).tasks?.findings[0]).toMatchObject({
			file: TASKS,
			tag: 'master',
			message: 'Task 1 has status "finished"',
			fixable: false,
			fix: expect.stringContaining('Use one of: pending')
		});
	});

	it('reports bad and duplicate IDs, and an ID that is not a number without printing it', () => {
		write(TASKS, {
			master: {
				tasks: [
					task('0'),
					task('3'),
					task(3),
					task('\u001b[2Jx', { dependencies: ['\u001b[2Jx'] })
				]
			}
		});

		expect(kinds()).toEqual(['bad-id 0', 'duplicate-id 3', 'bad-id #4']);
		expect(JSON.stringify(checkDataFiles(root))).not.toContain('2J');
	});

	it('reports a dependency on a missing task, but not on an archived one', () => {
		write(TASKS, {
			master: { tasks: [task('1', { dependencies: ['7', '99'] })] }
		});
		write('.taskgraph/tasks/archive.json', {
			master: { tasks: [task('7', { status: 'done' })] }
		});

		expect(checkDataFiles(root).tasks?.findings).toMatchObject([
			{
				kind: 'dependency',
				taskId: '1',
				message: 'Task 1 depends on non-existent task 99',
				fixable: true
			}
		]);
	});

	it('leaves a loop between tasks for the user, with the command', () => {
		write(TASKS, {
			feature: {
				tasks: [
					task('1', { dependencies: ['2'] }),
					task('2', { dependencies: ['1'] })
				]
			}
		});

		expect(checkDataFiles(root).tasks?.findings[0]).toMatchObject({
			kind: 'dependency',
			tag: 'feature',
			fixable: false,
			fix: expect.stringContaining(
				'`taskgraph depend --id=1 --depends-on=<id> --remove --tag=feature`'
			)
		});
	});

	it('reports a parent whose status disagrees with its subtasks', () => {
		write(TASKS, {
			master: {
				tasks: [
					task('1', {
						status: 'done',
						subtasks: [sub('1', 'done'), sub('2', 'pending')]
					}),
					task('2', { subtasks: [sub('1', 'done'), sub('2', 'cancelled')] }),
					// Held on purpose, and in step: neither is a finding
					task('3', { status: 'blocked', subtasks: [sub('1', 'done')] }),
					task('4', { status: 'in-progress', subtasks: [sub('1', 'pending')] })
				]
			}
		});

		expect(checkDataFiles(root).tasks?.findings).toMatchObject([
			{
				kind: 'parent-status',
				taskId: '1',
				message: 'Task 1 is done, but its subtasks make it in-progress',
				fixable: true
			},
			{
				kind: 'parent-status',
				taskId: '2',
				message: 'Task 2 is pending, but its subtasks make it done'
			}
		]);
	});

	it('survives entries that are not tasks', () => {
		write(TASKS, { master: { tasks: [null, 'x', task('1')] } });

		expect(kinds()).toEqual(['bad-id #1', 'bad-id #2']);
	});

	it('checks an untagged tasks.json as master', () => {
		write(TASKS, { tasks: [task('1', { status: 'nope' })], metadata: {} });

		expect(kinds()).toEqual(['unknown-status 1']);
	});
});

describe('doctor --fix', () => {
	const broken = () =>
		write(TASKS, {
			master: {
				tasks: [
					task('1', {
						status: 'done',
						subtasks: [sub('1', 'done'), sub('2', 'pending')]
					}),
					task('2', { dependencies: ['99', '2'] })
				]
			},
			feature: {
				tasks: [task('1', { subtasks: [sub('1', 'done'), sub('2', 'done')] })]
			}
		});

	it('repairs each tag, lists what it changed, and a second doctor passes', async () => {
		broken();

		const fixed = await tasksCheck(true);

		expect(fixed).toMatchObject({ status: 'pass', detail: '3 in 2 tags' });
		expect(fixed?.repaired).toEqual([
			{
				tag: 'master',
				taskId: '2',
				message: "Task 2 no longer depends on 99, which doesn't exist"
			},
			{
				tag: 'master',
				taskId: '2',
				message: 'Task 2 no longer depends on itself'
			},
			{
				tag: 'master',
				taskId: '1',
				message: 'Task 1 is now in-progress (was done)'
			},
			{
				tag: 'feature',
				taskId: '1',
				message: 'Task 1 is now done (was pending)'
			}
		]);
		expect(await tasksCheck()).toEqual({
			name: 'tasks',
			status: 'pass',
			detail: '3 in 2 tags'
		});
	});

	it('keeps a parent in progress when the Definition of Done refuses done', async () => {
		write('.taskgraph/config.json', {
			global: { definitionOfDone: ['Tests pass'] }
		});
		write(TASKS, {
			master: {
				tasks: [
					task('1', { status: 'in-progress', subtasks: [sub('1', 'done')] })
				]
			}
		});

		expect(await tasksCheck(true)).toMatchObject({ status: 'pass' });
		expect(JSON.parse(read(TASKS)).master.tasks[0].status).toBe('in-progress');
	});

	it('leaves what needs a decision, and the file, when nothing is fixable', async () => {
		write(TASKS, { master: { tasks: [task('1', { status: 'finished' })] } });
		const before = read(TASKS);

		const check = await tasksCheck(true);

		expect(check).toMatchObject({ status: 'fail' });
		expect(check?.repaired).toBeUndefined();
		expect(read(TASKS)).toBe(before);
	});

	it('does not write a healthy project', async () => {
		const before = read(TASKS);

		await doctor(true);

		expect(read(TASKS)).toBe(before);
	});

	it('repairs nothing while a data file cannot be read', async () => {
		broken();
		write('.taskgraph/config.json', '{ nope');
		const before = read(TASKS);

		const check = await tasksCheck(true);

		expect(check).toMatchObject({
			status: 'fail',
			repairError: '.taskgraph/config.json has to be fixed first'
		});
		expect(read(TASKS)).toBe(before);
		expect(read('.taskgraph/config.json')).toBe('{ nope');
	});

	it('says why when the write is refused, and leaves the file', async () => {
		broken();
		const data = JSON.parse(read(TASKS));
		data.feature.tasks.push(task('abc'));
		write(TASKS, data);
		const before = read(TASKS);

		const check = await tasksCheck(true);

		expect(check?.repairError).toMatch(/ID that isn't a number/);
		expect(read(TASKS)).toBe(before);
	});

	it('goes through the write funnel: the saved tag gets its metadata', async () => {
		broken();

		await repairTasks(root);

		expect(JSON.parse(read(TASKS)).master.metadata.highestId).toBe(2);
	});
});
