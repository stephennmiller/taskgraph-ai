import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { displayError } from './error-handler.js';

describe('displayError', () => {
	let output: string[];

	beforeEach(() => {
		output = [];
		vi.spyOn(console, 'error').mockImplementation((line?: unknown) => {
			output.push(String(line));
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('shows the message of a plain error', () => {
		displayError(new Error('disk is full'), { skipExit: true });

		expect(output.join('\n')).toContain('Error: disk is full');
	});

	it('shows the sanitized message of a TaskGraph error', () => {
		const taskGraphError = {
			getSanitizedDetails: () => ({ message: 'Task 7 was not found' }),
			stack: 'stack trace'
		};

		displayError(taskGraphError, { skipExit: true });

		const text = output.join('\n');
		expect(text).toContain('Task 7 was not found');
		expect(text).not.toContain('Error:');
	});

	it('shows the stack only when asked', () => {
		const error = new Error('boom');

		displayError(error, { skipExit: true });
		expect(output.join('\n')).not.toContain('Stack trace');

		output.length = 0;
		displayError(error, { skipExit: true, forceStack: true });
		expect(output.join('\n')).toContain('Stack trace');
	});

	it('exits with code 1 unless told to skip', () => {
		const exit = vi
			.spyOn(process, 'exit')
			.mockImplementation((() => undefined) as never);

		displayError(new Error('fatal'));

		expect(exit).toHaveBeenCalledWith(1);
	});
});
