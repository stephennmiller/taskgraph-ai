#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Fails when the built CLI starts too slowly (#248). An agent runs taskgraph
// dozens of times a session, so startup time is paid on every command.
// Shared runners are noisy: each command runs several times, and the median
// is compared to a budget well above what a laptop measures (about 40 ms for
// --version, 160 ms for list and next). Before #248 every command took 1.6 s.

/** Commands timed, with their budget in milliseconds */
export const BUDGETS = [
	{ args: ['--version'], budgetMs: 200 },
	{ args: ['list'], budgetMs: 400 },
	{ args: ['next'], budgetMs: 400 }
];

export function median(values) {
	if (values.length === 0) throw new Error('median of no values');
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** A tagged tasks.json with `count` tasks, each depending on the one before. */
export function buildFixtureTasks(count) {
	const statuses = ['done', 'in-progress', 'pending', 'pending'];
	const tasks = Array.from({ length: count }, (_, i) => ({
		id: i + 1,
		title: `Task ${i + 1}`,
		description: `Fixture task ${i + 1} for the startup time check`,
		details: '',
		testStrategy: '',
		status: statuses[i % statuses.length],
		dependencies: i === 0 ? [] : [i],
		priority: 'medium',
		subtasks: []
	}));
	return {
		master: {
			tasks,
			metadata: {
				created: '2026-01-01T00:00:00.000Z',
				updated: '2026-01-01T00:00:00.000Z',
				description: 'Tasks for master context'
			}
		}
	};
}

function createFixtureProject(taskCount) {
	const dir = mkdtempSync(join(tmpdir(), 'taskgraph-startup-'));
	mkdirSync(join(dir, '.taskgraph', 'tasks'), { recursive: true });
	writeFileSync(
		join(dir, '.taskgraph', 'tasks', 'tasks.json'),
		JSON.stringify(buildFixtureTasks(taskCount), null, '\t')
	);
	return dir;
}

function timeRun(cli, args, cwd) {
	const start = process.hrtime.bigint();
	execFileSync(process.execPath, [cli, ...args], {
		cwd,
		stdio: 'ignore',
		// No update check: it may fetch from npm, and would install an update
		env: { ...process.env, NO_COLOR: '1', TASKGRAPH_SKIP_AUTO_UPDATE: '1' }
	});
	return Number(process.hrtime.bigint() - start) / 1e6;
}

/**
 * Times each command `runs` times after one warm-up run and returns the
 * median per command.
 */
export function measure({ cli, runs, taskCount = 40, budgets = BUDGETS }) {
	const cwd = createFixtureProject(taskCount);
	try {
		return budgets.map(({ args, budgetMs }) => {
			timeRun(cli, args, cwd);
			const samples = Array.from({ length: runs }, () =>
				timeRun(cli, args, cwd)
			);
			return { command: args.join(' '), budgetMs, medianMs: median(samples) };
		});
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
}

// Run by the `startup-time` job in ci.yml after the build.
// Usage: node .github/scripts/check-startup-time.mjs [dist/taskgraph.js] [runs]
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const cli = resolve(process.argv[2] ?? 'dist/taskgraph.js');
	const runs = Number(process.argv[3] ?? 9);
	const results = measure({ cli, runs });

	let failed = false;
	for (const { command, budgetMs, medianMs } of results) {
		const over = medianMs > budgetMs;
		failed ||= over;
		const line = `taskgraph ${command}: median ${Math.round(medianMs)} ms of ${runs} runs (budget ${budgetMs} ms)`;
		console.log(over ? `::error::${line}` : line);
	}
	process.exit(failed ? 1 : 0);
}
