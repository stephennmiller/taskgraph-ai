import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { displayRecommendedNextTask } from './next-task.component.js';

// eslint-disable-next-line no-control-regex
const stripAnsi = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');

describe('displayRecommendedNextTask - suggested commands', () => {
	const original = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
	let logSpy: ReturnType<typeof vi.spyOn>;

	const render = (status: string): string => {
		displayRecommendedNextTask({ id: 7, title: 'Wire up auth', status });
		return stripAnsi(
			logSpy.mock.calls.map((call: unknown[]) => call.join(' ')).join('\n')
		);
	};

	beforeEach(() => {
		// Wide enough that boxen never wraps a command across lines
		Object.defineProperty(process.stdout, 'columns', {
			value: 200,
			configurable: true,
			writable: true
		});
		logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
	});

	afterEach(() => {
		logSpy.mockRestore();
		if (original) Object.defineProperty(process.stdout, 'columns', original);
		else delete (process.stdout as { columns?: number }).columns;
	});

	it('suggests starting a pending task', () => {
		expect(render('pending')).toContain(
			'taskgraph set-status --id=7 --status=in-progress'
		);
	});

	it('does not suggest starting a task that is already in progress', () => {
		const output = render('in-progress');

		expect(output).not.toContain('--status=in-progress');
		expect(output).toContain('taskgraph set-status --id=7 --status=done');
	});

	it('still points to the task details', () => {
		expect(render('in-progress')).toContain('taskgraph show 7');
	});
});
