import { stripVTControlCharacters } from 'node:util';
import { describe, expect, it } from 'vitest';
import { formatParsePrdSaved } from './parse-prd-formatters.js';

const plain = (text: string) => stripVTControlCharacters(text);

describe('formatParsePrdSaved', () => {
	it('says where the tasks went and gives one next-step line', () => {
		const output = plain(
			formatParsePrdSaved(
				{ tasksPath: '.taskgraph/tasks/tasks.json', added: 3, total: 3 },
				80
			)
		);

		expect(output.split('\n')).toEqual([
			'Saved to .taskgraph/tasks/tasks.json',
			'Next: taskgraph next to pick a task, or taskgraph expand --all to split them'
		]);
	});

	it('adds the new total when appending, and notes research', () => {
		const [saved] = plain(
			formatParsePrdSaved(
				{
					tasksPath: '.taskgraph/tasks/tasks.json',
					added: 3,
					total: 12,
					research: true
				},
				80
			)
		).split('\n');

		expect(saved).toBe(
			'Saved to .taskgraph/tasks/tasks.json · 12 tasks in total · research-backed'
		);
	});

	it.each([80, 60])('keeps the next-step line within %i columns', (width) => {
		const next = plain(
			formatParsePrdSaved(
				{ tasksPath: 'tasks.json', added: 1, total: 1 },
				width
			)
		).split('\n')[1];

		expect(next.length).toBeLessThanOrEqual(width);
		expect(next.startsWith('Next: taskgraph next')).toBe(true);
	});

	it('drops the second command when it would not fit', () => {
		const next = plain(
			formatParsePrdSaved({ tasksPath: 'tasks.json', added: 1, total: 1 }, 60)
		).split('\n')[1];

		expect(next).toBe('Next: taskgraph next to pick a task');
	});

	it('has no box', () => {
		const output = formatParsePrdSaved(
			{ tasksPath: 'tasks.json', added: 1, total: 1 },
			80
		);

		expect(output).not.toMatch(/[╭╮╰╯│]/);
	});
});
