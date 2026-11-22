/**
 * A full npm stage queue (E409, limit 100) used to fail after the GitHub
 * Release was already created, leaving releases that npm never got
 * (issue #1167). The release job must wait for the stage job.
 */

import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';

type Job = {
	needs?: string | string[];
	steps?: { run?: string }[];
};

const workflow = load(
	readFileSync('.github/workflows/version-bump.yml', 'utf8')
) as { jobs: Record<string, Job> };

function jobsRunning(command: string): string[] {
	return Object.entries(workflow.jobs)
		.filter(([, job]) => job.steps?.some((step) => step.run?.includes(command)))
		.map(([id]) => id);
}

describe('version-bump.yml release order', () => {
	it('creates the GitHub Release only after npm staging succeeds', () => {
		const [stageJob] = jobsRunning('npm stage publish');
		const releaseJobs = jobsRunning('gh release create');

		expect(stageJob).toBeDefined();
		expect(releaseJobs).toHaveLength(1);
		expect([workflow.jobs[releaseJobs[0]].needs].flat()).toContain(stageJob);
	});
});
