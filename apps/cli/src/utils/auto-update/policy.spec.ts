import { describe, expect, it } from 'vitest';
import { autoUpdateSkipReason } from './policy.js';

const argv = ['node', 'taskgraph', 'upgrade'];

describe('autoUpdateSkipReason', () => {
	it('skips in CI and without a terminal for an automatic update', () => {
		expect(
			autoUpdateSkipReason({ argv, env: { CI: '1' }, stdinIsTTY: true })
		).toBe('CI environment');
		expect(autoUpdateSkipReason({ argv, env: {}, stdinIsTTY: false })).toBe(
			'stdin is not a terminal'
		);
	});

	it('lets an explicit upgrade run in CI and without a terminal', () => {
		expect(
			autoUpdateSkipReason({
				argv,
				env: { CI: '1', TASKGRAPH_SKIP_AUTO_UPDATE: '1' },
				stdinIsTTY: false,
				explicit: true
			})
		).toBeNull();
	});

	it('refuses an explicit upgrade in a process loop started', () => {
		expect(
			autoUpdateSkipReason({
				argv,
				env: { TASKGRAPH_LOOP_CHILD: '1' },
				stdinIsTTY: true,
				explicit: true
			})
		).toBe('started by loop');
		expect(
			autoUpdateSkipReason({
				argv,
				env: { TASKGRAPH_PARALLEL_WORKER: '1' },
				stdinIsTTY: true,
				explicit: true
			})
		).toBe('started by a parallel worker');
	});
});
