import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
