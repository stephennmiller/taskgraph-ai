import { describe, expect, it } from 'vitest';
import { childAutoUpdateEnv } from './child-env.js';

describe('childAutoUpdateEnv', () => {
	it('drops the task-data fence opt-out so loop keeps the fences (#929)', () => {
		const env = childAutoUpdateEnv('loop', {
			PATH: '/bin',
			TASKGRAPH_NO_TASK_DATA_FENCE: '1'
		});

		expect(env.TASKGRAPH_LOOP_CHILD).toBe('1');
		expect(env.TASKGRAPH_SKIP_AUTO_UPDATE).toBe('1');
		expect(env.TASKGRAPH_NO_TASK_DATA_FENCE).toBeUndefined();
		expect(env.PATH).toBe('/bin');
	});

	it('drops the opt-out for a parallel worker too (#929)', () => {
		const env = childAutoUpdateEnv('parallel', {
			TASKGRAPH_NO_TASK_DATA_FENCE: '1'
		});

		expect(env.TASKGRAPH_PARALLEL_WORKER).toBe('1');
		expect(env.TASKGRAPH_LOOP_CHILD).toBeUndefined();
		expect(env.TASKGRAPH_NO_TASK_DATA_FENCE).toBeUndefined();
	});
});
