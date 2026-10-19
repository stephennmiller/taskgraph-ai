#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';

// A job without `timeout-minutes` silently gets GitHub's 6-hour default, so a
// hung step burns runner minutes for hours before anyone notices. Jobs that call
// a reusable workflow (`uses:`) are skipped: GitHub rejects `timeout-minutes`
// on them, the timeout belongs on the called workflow's jobs.
export function findJobsMissingTimeout(workflow) {
	const jobs = workflow?.jobs;
	if (!jobs || typeof jobs !== 'object') return [];

	return Object.entries(jobs)
		.filter(([, job]) => !job?.uses && job?.['timeout-minutes'] === undefined)
		.map(([id]) => id);
}

export function findWorkflowsMissingTimeouts(dir) {
	return readdirSync(dir)
		.filter((name) => /\.ya?ml$/.test(name))
		.sort()
		.flatMap((file) =>
			findJobsMissingTimeout(load(readFileSync(join(dir, file), 'utf8'))).map(
				(job) => ({ file, job })
			)
		);
}

// Run by the `job-timeouts` job in workflow-lint.yml.
// Usage: node .github/scripts/check-job-timeouts.mjs [workflowsDir]
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const dir = process.argv[2] ?? '.github/workflows';
	const missing = findWorkflowsMissingTimeouts(dir);

	for (const { file, job } of missing) {
		console.log(
			`::error file=${join(dir, file)}::job "${job}" has no timeout-minutes (defaults to 6 hours)`
		);
	}

	if (missing.length > 0) {
		console.error(`${missing.length} job(s) missing timeout-minutes.`);
		process.exit(1);
	}
	console.log('All workflow jobs set timeout-minutes.');
}
