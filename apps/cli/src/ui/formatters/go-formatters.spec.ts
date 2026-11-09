import { describe, expect, it } from 'vitest';
import { formatGoResume } from './go-formatters.js';

describe('formatGoResume', () => {
	it('says what a rerun resumes, naming the one task in progress', () => {
		expect(
			formatGoResume({ done: 3, 'in-progress': 1, pending: 5 }, [{ id: '4' }])
		).toBe('Resuming: 3 done, task 4 in progress, 5 pending');
	});

	it('counts several in progress, and tasks in review or blocked', () => {
		expect(
			formatGoResume({ review: 1, blocked: 2, pending: 1 }, [
				{ id: '4.1' },
				{ id: '6' }
			])
		).toBe('Resuming: 2 in progress, 1 in review, 2 blocked, 1 pending');
	});

	it('prints nothing on a first run, with every task pending', () => {
		expect(formatGoResume({ pending: 6, done: 0 }, [])).toBeNull();
	});

	it('strips control codes from a task ID', () => {
		expect(
			formatGoResume({ done: 1 }, [{ id: '4\u001b[2J' }])
		).not.toContain('\u001b');
	});
});
