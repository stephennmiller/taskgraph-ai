import type { Task } from '@tm/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createTaskTable } from './tables.js';

import {
	HOSTILE,
	sgrFree,
	UNSAFE
} from '../../../tests/helpers/hostile-text.js';

// eslint-disable-next-line no-control-regex
const stripAnsi = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');

const makeTask = (id: string, tagName: string): Task & { tagName: string } => ({
	id,
	title: `Task ${id}`,
	description: '',
	status: 'pending',
	priority: 'medium',
	dependencies: [],
	details: '',
	testStrategy: '',
	subtasks: [],
	tagName
});

describe('createTaskTable - narrow terminals', () => {
	const original = Object.getOwnPropertyDescriptor(process.stdout, 'columns');

	afterEach(() => {
		if (original) Object.defineProperty(process.stdout, 'columns', original);
		else delete (process.stdout as { columns?: number }).columns;
	});

	it('keeps the Tag column when listing all tags, since IDs repeat across tags', () => {
		Object.defineProperty(process.stdout, 'columns', {
			value: 80,
			configurable: true,
			writable: true
		});

		const output = stripAnsi(
			createTaskTable([makeTask('1', 'alpha'), makeTask('1', 'beta')], {
				showTag: true,
				showComplexity: true,
				showBlocks: true
			})
		);

		expect(output).toContain('Tag');
		expect(output).toContain('alpha');
		expect(output).toContain('beta');
	});

	const setColumns = (value: number) =>
		Object.defineProperty(process.stdout, 'columns', {
			value,
			configurable: true,
			writable: true
		});
	const listOptions = {
		showDependencies: true,
		showBlocks: true,
		showComplexity: true
	};
	const widest = (output: string) =>
		Math.max(...output.split('\n').map((line) => line.length));

	it('fits every line in a 50-column terminal by hiding Priority before cutting Title', () => {
		setColumns(50);
		const tasks = ['1', '2', '12'].map((id) => makeTask(id, 'master'));

		const output = stripAnsi(createTaskTable(tasks, listOptions));

		expect(widest(output)).toBeLessThanOrEqual(50);
		expect(output).toContain('Title');
		expect(output).not.toContain('│ Priority');
		expect(output).toContain('Priority');
	});

	it('sizes the ID column to the longest ID', () => {
		setColumns(80);

		const output = stripAnsi(
			createTaskTable([makeTask('1', 'master'), makeTask('12', 'master')])
		);

		expect(output).toContain('│ ID │');
		expect(output).toContain('│ 12 │');
	});

	it('fits a 50-column terminal when listing all tags', () => {
		setColumns(50);
		const tasks = [makeTask('1', 'master'), makeTask('1', 'feature')];

		const output = stripAnsi(
			createTaskTable(tasks, { ...listOptions, showTag: true })
		);

		expect(widest(output)).toBeLessThanOrEqual(50);
		expect(output).toContain('feature');
	});
});

describe('createTaskTable with escape sequences in task text', () => {
	it('prints titles and subtask titles without them', () => {
		const subtask = {
			id: 1,
			parentId: '1',
			title: HOSTILE,
			description: '',
			status: 'pending',
			priority: 'medium',
			dependencies: [],
			details: '',
			testStrategy: ''
		} satisfies Task['subtasks'][number];
		const task = {
			...makeTask('1', 'alpha'),
			title: HOSTILE,
			subtasks: [subtask]
		};

		const out = sgrFree(createTaskTable([task], { showSubtasks: true }));

		expect(out).toContain('Fix login');
		expect(out).not.toMatch(UNSAFE);
	});
});
