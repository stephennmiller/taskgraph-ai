import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	findJobsMissingTimeout,
	findWorkflowsMissingTimeouts
} from '../../../.github/scripts/check-job-timeouts.mjs';

describe('findJobsMissingTimeout', () => {
	it('returns the ids of jobs with no timeout-minutes', () => {
		const workflow = {
			jobs: {
				build: { 'runs-on': 'ubuntu-latest' },
				test: { 'runs-on': 'ubuntu-latest', 'timeout-minutes': 10 }
			}
		};
		expect(findJobsMissingTimeout(workflow)).toEqual(['build']);
	});

	it('treats a numeric 0 as set, not missing', () => {
		const workflow = { jobs: { a: { 'timeout-minutes': 0 } } };
		expect(findJobsMissingTimeout(workflow)).toEqual([]);
	});

	it('skips jobs that call a reusable workflow, which GitHub forbids timeouts on', () => {
		const workflow = {
			jobs: { call: { uses: './.github/workflows/other.yml' } }
		};
		expect(findJobsMissingTimeout(workflow)).toEqual([]);
	});

	it.each([
		['null workflow', null],
		['no jobs key', {}],
		['non-object jobs', { jobs: 'nope' }]
	])('returns [] for %s', (_label, workflow) => {
		expect(findJobsMissingTimeout(workflow)).toEqual([]);
	});

	it('does not throw on a null job body', () => {
		expect(findJobsMissingTimeout({ jobs: { empty: null } })).toEqual([
			'empty'
		]);
	});
});

describe('findWorkflowsMissingTimeouts', () => {
	let dir;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'job-timeouts-'));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it('reports file and job for each offender and ignores non-yaml files', () => {
		writeFileSync(
			join(dir, 'good.yml'),
			'jobs:\n  a:\n    runs-on: x\n    timeout-minutes: 5\n'
		);
		writeFileSync(join(dir, 'bad.yaml'), 'jobs:\n  b:\n    runs-on: x\n');
		writeFileSync(join(dir, 'notes.md'), 'jobs: not yaml');

		expect(findWorkflowsMissingTimeouts(dir)).toEqual([
			{ file: 'bad.yaml', job: 'b' }
		]);
	});

	it('returns [] when every job sets a timeout', () => {
		writeFileSync(
			join(dir, 'ok.yml'),
			'jobs:\n  a:\n    runs-on: x\n    timeout-minutes: 5\n'
		);
		expect(findWorkflowsMissingTimeouts(dir)).toEqual([]);
	});
});

describe('this repo', () => {
	it('has a timeout on every workflow job', () => {
		expect(findWorkflowsMissingTimeouts('.github/workflows')).toEqual([]);
	});
});
