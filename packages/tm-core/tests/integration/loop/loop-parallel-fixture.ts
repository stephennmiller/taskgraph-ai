/**
 * @fileoverview The fake Claude Code and `taskgraph` that loop-parallel.test.ts
 * and loop-parallel-merge.test.ts run, and the helpers their tests share
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

export const FAKE_CLAUDE = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const plan = JSON.parse(fs.readFileSync(process.env.FAKE_CLAUDE_PLAN, 'utf8'));
const name = path.basename(process.cwd());
const resolving = /conflicts with commit (\\w+)/.exec(process.argv.join(' '))?.[1];
// A resolve's stdout is its one --output-format json result
if (!resolving) console.log(JSON.stringify(process.argv.slice(2)));
const mode = plan[name] || 'nothing';
const taskgraph = (...args) =>
	execFileSync(
		process.execPath,
		[process.env.FAKE_TSX, process.env.FAKE_TASKGRAPH, ...args],
		{ stdio: 'inherit' }
	);
if (mode === 'review') {
	const id = name.slice('task-'.length);
	taskgraph('show', id);
	fs.writeFileSync('work.txt', 'done\\n');
	execFileSync('git', ['add', 'work.txt']);
	execFileSync('git', ['commit', '-q', '-m', 'work on ' + name]);
	taskgraph('set-status', '--id=' + id, '--status=review');
	process.exit(0);
}
if (mode === 'commit' || mode === 'commit-fail') {
	fs.writeFileSync('work.txt', 'done\\n');
	execFileSync('git', ['add', 'work.txt']);
	execFileSync('git', ['commit', '-q', '-m', 'work on ' + name]);
	// stream-json's last event: what the run cost
	console.log(JSON.stringify({ type: 'result', subtype: 'success', result: 'done', total_cost_usd: 0.25, num_turns: 3 }));
	process.exit(mode === 'commit' ? 0 : 1);
}
// --merge: both tasks commit the same file, so the second conflicts. Asked to
// resolve it, commit the merge but leave the fix it made uncommitted (#1026)
if (mode === 'merge-conflict-uncommitted') {
	const id = name.slice('task-'.length);
	if (resolving) {
		try {
			execFileSync('git', ['merge', '--no-edit', resolving], { stdio: 'ignore' });
		} catch {}
		fs.writeFileSync('shared.txt', 'both\\n');
		execFileSync('git', ['commit', '-q', '-am', 'merge']);
		fs.writeFileSync('shared.txt', 'both, fixed\\n');
		console.log(JSON.stringify({ type: 'result', total_cost_usd: 0.5 }));
		process.exit(0);
	}
	fs.writeFileSync('shared.txt', id + '\\n');
	execFileSync('git', ['add', 'shared.txt']);
	execFileSync('git', ['commit', '-q', '-m', 'work on ' + name]);
	taskgraph('set-status', '--id=' + id, '--status=review');
	console.log(JSON.stringify({ type: 'result', subtype: 'success', result: 'done', total_cost_usd: 0.25, num_turns: 3 }));
	process.exit(0);
}
// --merge: a file of its own, committed, left uncommitted, or none at all
if (mode.startsWith('merge-')) {
	const id = name.slice('task-'.length);
	if (mode !== 'merge-nothing') fs.writeFileSync('work-' + id + '.txt', 'done\\n');
	if (mode === 'merge-commit') {
		execFileSync('git', ['add', 'work-' + id + '.txt']);
		execFileSync('git', ['commit', '-q', '-m', 'work on ' + name]);
	}
	taskgraph('set-status', '--id=' + id, '--status=review');
	process.exit(0);
}
if (mode === 'fail') process.exit(1);
if (mode === 'sleep' || mode === 'dirty-sleep' || mode === 'commit-sleep' || mode === 'deaf-sleep') {
	// Deaf to SIGTERM: only SIGKILL after the grace period stops it (#1121)
	if (mode === 'deaf-sleep') process.on('SIGTERM', () => {});
	if (mode === 'dirty-sleep') fs.writeFileSync('partial.txt', 'wip\\n');
	if (mode === 'commit-sleep') {
		fs.writeFileSync('work.txt', 'done\\n');
		execFileSync('git', ['add', 'work.txt']);
		execFileSync('git', ['commit', '-q', '-m', 'work on ' + name]);
	}
	fs.writeFileSync(path.join(plan.pidDir, name), String(process.pid));
	setInterval(() => {}, 1000);
} else {
	process.exit(0);
}
`;

/** The `taskgraph` the fake Claude runs: just enough of show and set-status */
export const fakeTaskgraph = (corePath: string) => `
import { createTmCore, resolveProjectRoot } from ${JSON.stringify(corePath)};
const [command, ...rest] = process.argv.slice(2);
const flag = (name: string) =>
	rest.find((a) => a.startsWith('--' + name + '='))?.slice(name.length + 3);
const tmCore = await createTmCore({
	projectPath: resolveProjectRoot(flag('project'))
});
try {
	if (command === 'show') {
		const { task } = await tmCore.tasks.get(rest[0], flag('tag'));
		if (!task) throw new Error('No task ' + rest[0]);
		console.log(task.title);
	} else if (command === 'set-status') {
		await tmCore.tasks.updateStatus(flag('id')!, flag('status') as never, flag('tag'));
	}
} finally {
	await tmCore.close();
}
`;

export const task = (id: string, dependencies: string[] = []) => ({
	id,
	title: `Task ${id}`,
	description: `Do task ${id}`,
	status: 'pending',
	priority: 'medium',
	dependencies,
	details: '',
	testStrategy: '',
	subtasks: []
});

export const git = (cwd: string, ...args: string[]) =>
	execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

export const isAlive = (pid: number) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

/** isAlive, not counting a zombie: a killed process can stay one until its new parent reaps it */
export const isRunning = (pid: number) => {
	if (!isAlive(pid)) return false;
	try {
		return !/\) Z /.test(fs.readFileSync(`/proc/${pid}/stat`, 'utf8'));
	} catch {
		// On Linux a missing stat means the zombie was reaped after the kill check (#911); no /proc elsewhere
		return process.platform !== 'linux';
	}
};
