import { describe, expect, it } from 'vitest';
import { runSmokeCheck, smokeCommandFor } from './smoke-gate.js';

const inLoop = { TASKGRAPH_LOOP_CHILD: '1' };

describe('smokeCommandFor', () => {
	it('is off outside a loop run, so a cloned config runs nothing by hand', () => {
		expect(smokeCommandFor({ smokeCommand: 'npm start' }, {})).toBeUndefined();
	});

	it('returns the command in a loop run or a parallel worker', () => {
		expect(smokeCommandFor({ smokeCommand: 'npm start' }, inLoop)).toBe(
			'npm start'
		);
		expect(
			smokeCommandFor(
				{ smokeCommand: 'npm start' },
				{ TASKGRAPH_PARALLEL_WORKER: '1' }
			)
		).toBe('npm start');
	});

	it('is undefined when the setting is missing', () => {
		expect(smokeCommandFor(undefined, inLoop)).toBeUndefined();
		expect(smokeCommandFor({}, inLoop)).toBeUndefined();
	});

	it.each([[''], ['  '], [3], [['npm', 'start']]])(
		'refuses %j with a hint',
		(value) => {
			expect(() => smokeCommandFor({ smokeCommand: value }, inLoop)).toThrow(
				/loop\.smokeCommand/
			);
		}
	);
});

describe('runSmokeCheck', () => {
	it('passes when the command exits 0', async () => {
		await expect(
			runSmokeCheck('node -e "process.exit(0)"', process.cwd(), ['3'])
		).resolves.toBeUndefined();
	});

	it('refuses done with the exit code and the output tail', async () => {
		const run = runSmokeCheck(
			'node -e "console.log(\'ERROR: stub dispatcher\'); process.exit(2)"',
			process.cwd(),
			['3', '4']
		);

		await expect(run).rejects.toThrow(/Task 3, 4 not marked done/);
		await expect(run).rejects.toThrow(/exited with 2/);
		await expect(run).rejects.toThrow(/ERROR: stub dispatcher/);
	});
});
