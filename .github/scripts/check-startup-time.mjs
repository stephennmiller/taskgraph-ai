#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Fails when the built CLI starts too slowly (#248). An agent runs taskgraph
// dozens of times a session, so startup time is paid on every command.
// Shared runners are noisy: each command runs several times, and the median
// is compared to a budget well above what a laptop measures (about 40 ms for
// --version, 160 ms for list and next). Before #248 every command took 1.6 s.
// It also fails when a command imports a package in HEAVY_PACKAGES, which a
// fast runner could absorb within the budget.

/** Commands timed, with their budget in milliseconds */
export const BUDGETS = [
	{ args: ['--version'], budgetMs: 200 },
	{ args: ['list'], budgetMs: 400 },
	{ args: ['next'], budgetMs: 400 }
];

/**
 * Packages that `list` and `next` must not load: the AI SDKs, markdown
 * rendering, prompts and the MCP server. The timing budgets catch them on a
 * fast runner; this catches them deterministically, including when rolldown
 * moves a @tm/core module into a lazy chunk that loads one of them.
 */
export const HEAVY_PACKAGES = [
	'ai',
	'@ai-sdk/',
	'@anthropic-ai/',
	'ai-sdk-provider-claude-code',
	'jsonrepair',
	'marked',
	'marked-terminal',
	'highlight.js',
	'turndown',
	'inquirer',
	'@inquirer/',
	'ajv',
	'fastmcp',
	'@modelcontextprotocol/',
	'date-fns'
];

/**
 * The heavy packages, and any MCP server code, among the module URLs a
 * command loaded.
 *
 * @param {string[]} urls - Resolved module URLs
 * @returns {string[]} The offending package names and dist files, sorted
 */
export function findHeavyImports(urls) {
	const found = new Set();
	for (const url of urls) {
		const pkg = url.match(/.*\/node_modules\/((?:@[^/]+\/)?[^/]+)\//)?.[1];
		if (
			pkg &&
			HEAVY_PACKAGES.some((name) =>
				name.endsWith('/') ? pkg.startsWith(name) : pkg === name
			)
		) {
			found.add(pkg);
		}
		if (/\/dist\/mcp-server\.js$/.test(url)) found.add('dist/mcp-server.js');
	}
	return [...found].sort();
}

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
 * The module URLs that `cli args` loads: imports recorded by a resolve hook,
 * and require() calls read from the CommonJS cache when the process exits.
 */
function loadedModules(cli, args, cwd) {
	const log = join(cwd, 'resolved.log');
	const hooks = join(cwd, 'resolve-hooks.mjs');
	const register = join(cwd, 'register-hooks.mjs');
	writeFileSync(
		hooks,
		[
			"import { appendFileSync } from 'node:fs';",
			'export async function resolve(specifier, context, next) {',
			'\tconst result = await next(specifier, context);',
			'\tappendFileSync(process.env.TASKGRAPH_RESOLVE_LOG, `${result.url}\\n`);',
			'\treturn result;',
			'}'
		].join('\n')
	);
	// require() (createRequire) skips the resolve hook: its modules are
	// listed from the CommonJS cache on exit
	writeFileSync(
		register,
		[
			"import { appendFileSync } from 'node:fs';",
			"import Module, { register } from 'node:module';",
			"import { pathToFileURL } from 'node:url';",
			`register(${JSON.stringify(pathToFileURL(hooks).href)});`,
			"process.on('exit', () => {",
			'\tconst urls = Object.keys(Module._cache).map((file) => pathToFileURL(file).href);',
			"\tappendFileSync(process.env.TASKGRAPH_RESOLVE_LOG, urls.map((url) => `${url}\\n`).join(''));",
			'});'
		].join('\n')
	);
	writeFileSync(log, '');
	execFileSync(
		process.execPath,
		['--import', pathToFileURL(register).href, cli, ...args],
		{
			cwd,
			stdio: 'ignore',
			env: {
				...process.env,
				NO_COLOR: '1',
				TASKGRAPH_SKIP_AUTO_UPDATE: '1',
				TASKGRAPH_RESOLVE_LOG: log
			}
		}
	);
	return readFileSync(log, 'utf8').split('\n').filter(Boolean);
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
			return {
				command: args.join(' '),
				budgetMs,
				medianMs: median(samples),
				heavyImports: findHeavyImports(loadedModules(cli, args, cwd))
			};
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
	for (const { command, budgetMs, medianMs, heavyImports } of results) {
		const over = medianMs > budgetMs;
		failed ||= over;
		const line = `taskgraph ${command}: median ${Math.round(medianMs)} ms of ${runs} runs (budget ${budgetMs} ms)`;
		console.log(over ? `::error::${line}` : line);
		if (heavyImports.length > 0) {
			failed = true;
			console.log(
				`::error::taskgraph ${command} loads ${heavyImports.join(', ')} at startup. Import heavy packages inside the function that uses them.`
			);
		}
	}
	process.exit(failed ? 1 : 0);
}
