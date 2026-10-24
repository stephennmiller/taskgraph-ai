import { describe, expect, it } from 'vitest';
import { formatScopeResult } from './scope-formatters.js';

const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');
const scoped = (id: string, title: string, extra = {}) => ({
	task: { id, title } as any,
	regenerated: false,
	preserved: 0,
	generated: 0,
	...extra
});

describe('formatScopeResult', () => {
	it('counts the tasks and lists each with its subtask change', () => {
		const text = strip(
			formatScopeResult(
				{
					tasks: [
						scoped('3', 'Bigger', {
							regenerated: true,
							preserved: 1,
							generated: 5
						}),
						scoped('4', 'No subtasks')
					]
				},
				'up'
			)
		);

		expect(text).toBe(
			'✓ Scoped up 2 tasks\n  3  Bigger · 1 subtask kept, 5 new\n  4  No subtasks'
		);
	});

	it('says task for one, and strips control codes from AI titles', () => {
		const text = formatScopeResult(
			{ tasks: [scoped('3', 'Small\x1b]0;pwned\x07')] },
			'down'
		);

		expect(strip(text)).toContain('✓ Scoped down 1 task\n');
		expect(text).not.toContain('\x1b]0;');
	});
});
