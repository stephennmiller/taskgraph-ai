/**
 * @tm/core keeps 80% coverage thresholds, and Vitest applies them only when
 * coverage is on. Plain `npm run test` leaves coverage off (#259). The Test
 * job has to run `test:coverage` for @tm/core, or those thresholds never
 * block a merge (#711).
 */

import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';

interface WorkflowStep {
	name?: string;
	run?: string;
}

interface Workflow {
	jobs?: {
		test?: {
			steps?: WorkflowStep[];
		};
	};
}

/** The `run` script of the Test job step that executes one workspace's tests. */
function packageTestCommand(
	workflow: Workflow,
	stepName: string
): string | undefined {
	const run = workflow.jobs?.test?.steps?.find(
		(step) => step?.name === stepName
	)?.run;
	return typeof run === 'string' ? run : undefined;
}

/**
 * True when a CI step runs that workspace's `test:coverage` script.
 * `npm run test -w @tm/core` does not count: coverage stays off, so the
 * thresholds in vitest.config.ts never run.
 */
function runsPackageCoverage(
	run: string | undefined,
	workspace: string
): boolean {
	if (!run) return false;
	const escaped = workspace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const pattern = new RegExp(
		`npm run test:coverage\\s+-w\\s+${escaped}(?:\\s|$)`
	);
	return pattern.test(run);
}

function loadWorkflow(path: string): Workflow {
	return load(readFileSync(path, 'utf8')) as Workflow;
}

describe('runsPackageCoverage', () => {
	it('rejects the plain test script that leaves coverage off', () => {
		expect(runsPackageCoverage('npm run test -w @tm/core', '@tm/core')).toBe(
			false
		);
	});

	it('accepts test:coverage, including extra vitest args', () => {
		expect(
			runsPackageCoverage('npm run test:coverage -w @tm/core', '@tm/core')
		).toBe(true);
		expect(
			runsPackageCoverage(
				'npm run test:coverage -w @tm/core -- --maxWorkers=2',
				'@tm/core'
			)
		).toBe(true);
	});

	it('does not treat another workspace or a suffixed name as a match', () => {
		expect(
			runsPackageCoverage('npm run test:coverage -w @tm/cli', '@tm/core')
		).toBe(false);
		expect(
			runsPackageCoverage('npm run test:coverage -w @tm/core-extra', '@tm/core')
		).toBe(false);
	});
});

describe('@tm/core coverage gate in CI', () => {
	const workflow = loadWorkflow('.github/workflows/ci.yml');
	const command = packageTestCommand(workflow, 'Run @tm/core tests');

	it('runs test:coverage so the 80% thresholds gate the merge', () => {
		expect(runsPackageCoverage(command, '@tm/core')).toBe(true);
	});

	it('points test:coverage at vitest --coverage', () => {
		const pkg = JSON.parse(
			readFileSync('packages/tm-core/package.json', 'utf8')
		) as { scripts?: { 'test:coverage'?: string } };
		expect(pkg.scripts?.['test:coverage'] ?? '').toMatch(
			/(?:^|\s)--coverage(?:\s|$)/
		);
	});
});
