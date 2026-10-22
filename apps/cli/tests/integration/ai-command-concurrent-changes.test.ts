/**
 * @fileoverview An AI command reads tasks.json, waits on the model, then
 * saves. Changes other commands make while it waits must survive that save
 * (#243). The fake `claude` holds its answer until the test releases it, so
 * the other changes land exactly while the AI command is waiting.
 *
 * Needs the build (`npm run build`); skipped when dist/ is missing.
 *
 * @integration
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installFakeClaude, readTrace } from '../fakes/install-fake-claude.mjs';
import { getCliBinPath } from '../helpers/test-utils.js';

const binPath = getCliBinPath();
const built = fs.existsSync(binPath);
if (!built && process.env.CI) {
	throw new Error(
		`${binPath} is missing; run npm run build before these tests in CI`
	);
}

const TASK_COUNT = 10;

interface Finished {
	status: number | null;
	stdout: string;
	stderr: string;
}

interface SavedTask {
	id: number | string;
	title: string;
	status: string;
	details?: string;
	subtasks?: { id: number; title: string; status: string; details?: string }[];
}

describe.skipIf(!built)('changes made while an AI command runs', () => {
	let project: string;
	let work: string;
	let env: NodeJS.ProcessEnv;
	let fakeDir: string;

	const tasksFile = () =>
		path.join(project, '.taskgraph', 'tasks', 'tasks.json');
	const readSaved = () => JSON.parse(fs.readFileSync(tasksFile(), 'utf8'));
	const readTasks = (): SavedTask[] => readSaved().master.tasks;
	const task = (id: number) =>
		readTasks().find((t) => String(t.id) === String(id));

	const taskgraph = (...args: string[]) =>
		spawnSync(process.execPath, [binPath, ...args], {
			cwd: project,
			encoding: 'utf8',
			timeout: 30000,
			env
		});

	/** Start an AI command without waiting for it */
	const startAiCommand = (...args: string[]) =>
		new Promise<Finished>((resolve) => {
			const child = spawn(process.execPath, [binPath, ...args], {
				cwd: project,
				env,
				stdio: 'pipe',
				timeout: 60000,
				killSignal: 'SIGKILL'
			});
			let stdout = '';
			let stderr = '';
			child.stdout.on('data', (d) => (stdout += d));
			child.stderr.on('data', (d) => (stderr += d));
			child.on('close', (status) => resolve({ status, stdout, stderr }));
		});

	/** Wait until the AI command has read the tasks and called the model */
	const waitForModelCall = async () => {
		const started = Date.now();
		while (readTrace(fakeDir).length === 0) {
			if (Date.now() - started > 30000) {
				throw new Error('the AI command never called the model');
			}
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
	};

	const release = () => fs.writeFileSync(path.join(fakeDir, 'release'), 'go');

	/** The changes another session makes while the model is thinking */
	const changeTasksMeanwhile = () => {
		const setStatus = taskgraph('set-status', '--id=9', '--status=done');
		expect(setStatus.status, setStatus.stderr).toBe(0);
		const addTask = taskgraph(
			'add-task',
			'--title=Added during AI call',
			'--description=Added while the model was thinking'
		);
		expect(addTask.status, addTask.stderr).toBe(0);
		expect(task(9)?.status).toBe('done');
		expect(readTasks()).toHaveLength(TASK_COUNT + 1);
	};

	const expectChangesKept = () => {
		const tasks = readTasks();
		expect(task(9)?.status).toBe('done');
		expect(tasks).toHaveLength(TASK_COUNT + 1);
		expect(tasks.map((t) => t.title)).toContain('Added during AI call');
	};

	beforeEach(() => {
		project = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-ai-concurrent-'));
		work = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-ai-concurrent-work-'));
		const init = spawnSync(
			process.execPath,
			[binPath, 'init', '--yes', '--no-aliases', '--no-git'],
			{
				cwd: project,
				encoding: 'utf8',
				input: '',
				env: { ...process.env, TASKGRAPH_SKIP_AUTO_UPDATE: '1' }
			}
		);
		expect(init.status).toBe(0);

		const tasks = Array.from({ length: TASK_COUNT }, (_, i) => ({
			id: i + 1,
			title: `Task ${i + 1}`,
			description: `Task ${i + 1} description`,
			details: '',
			testStrategy: '',
			status: 'pending',
			priority: 'medium',
			dependencies: [],
			subtasks:
				i === 4
					? [
							{
								id: 1,
								title: 'Subtask 5.1',
								description: 'First step',
								details: '',
								status: 'pending',
								dependencies: []
							}
						]
					: []
		}));
		fs.writeFileSync(
			tasksFile(),
			JSON.stringify({
				master: {
					tasks,
					metadata: { created: '2026-01-01T00:00:00.000Z' }
				}
			})
		);

		const fake = installFakeClaude({
			projectDir: project,
			workDir: work,
			replies: [{ holdUntil: 'release' }]
		});
		fakeDir = fake.dir;
		env = {
			...process.env,
			FORCE_COLOR: '0',
			TASKGRAPH_SKIP_AUTO_UPDATE: '1',
			...fake.env
		};
		// Starting the built CLI for init can take over 15s on a busy machine
	}, 60000);

	afterEach(() => {
		fs.rmSync(project, { recursive: true, force: true });
		fs.rmSync(work, { recursive: true, force: true });
	});

	it('update-task keeps a status change and a new task made meanwhile', async () => {
		const running = startAiCommand(
			'update-task',
			'--id=5',
			'--prompt=Use postgres'
		);
		await waitForModelCall();

		changeTasksMeanwhile();
		release();
		const result = await running;

		expect(result.status, result.stderr).toBe(0);
		expectChangesKept();
		// The AI command's own change is saved too
		expect(task(5)?.title).not.toBe('Task 5');
	}, 90000);

	it('update-subtask keeps a status change and a new task made meanwhile', async () => {
		const running = startAiCommand(
			'update-subtask',
			'--id=5.1',
			'--prompt=Note the schema'
		);
		await waitForModelCall();

		changeTasksMeanwhile();
		release();
		const result = await running;

		expect(result.status, result.stderr).toBe(0);
		expectChangesKept();
		expect(task(5)?.subtasks?.[0].details).toContain('Sample text answer');
	}, 90000);

	it('update --from keeps a status change and a new task made meanwhile', async () => {
		const running = startAiCommand(
			'update',
			'--from=10',
			'--prompt=Use postgres'
		);
		await waitForModelCall();

		changeTasksMeanwhile();
		release();
		const result = await running;

		expect(result.status, result.stderr).toBe(0);
		expectChangesKept();
	}, 90000);

	it('a status set on the task being updated survives the update', async () => {
		const running = startAiCommand(
			'update-task',
			'--id=5',
			'--prompt=Use postgres'
		);
		await waitForModelCall();

		const setStatus = taskgraph('set-status', '--id=5', '--status=in-progress');
		expect(setStatus.status, setStatus.stderr).toBe(0);
		release();
		const result = await running;

		expect(result.status, result.stderr).toBe(0);
		expect(task(5)?.status).toBe('in-progress');
		expect(task(5)?.title).not.toBe('Task 5');
	}, 90000);
});
