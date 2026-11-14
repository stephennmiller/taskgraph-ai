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

	it('draws a rule under the header and none between rows', () => {
		setColumns(80);
		const tasks = ['1', '2', '3'].map((id) => makeTask(id, 'master'));

		const lines = stripAnsi(createTaskTable(tasks, listOptions)).split('\n');

		expect(lines.filter((line) => line.startsWith('├'))).toHaveLength(1);
		expect(lines[2]).toMatch(/^├/);
		// Top border, header, header rule, one line per task, bottom border
		expect(lines.findIndex((line) => line.startsWith('└'))).toBe(
			3 + tasks.length
		);
	});

	it('leaves out Complexity when no task has a score, and shows it when one does', () => {
		setColumns(120);
		const scored = { ...makeTask('2', 'master'), complexity: 7 };

		const without = stripAnsi(
			createTaskTable([makeTask('1', 'master')], listOptions)
		);
		const withScore = stripAnsi(
			createTaskTable([makeTask('1', 'master'), scored], listOptions)
		);

		expect(without).not.toContain('Complexity');
		expect(withScore).toContain('│ Complexity');
	});

	it('keeps Blocks at 60 columns when asked to, hiding Deps and Priority instead', () => {
		setColumns(60);
		const task = { ...makeTask('1', 'master'), blocks: ['2'] };

		const output = stripAnsi(
			createTaskTable([task], { ...listOptions, keepBlocks: true })
		);

		expect(output).toContain('│ Blocks');
		expect(output).toContain('Hidden to fit width: Deps, Priority');
	});

	// #1148: Status, Dependencies and Blocks were 15, 14 and 10 wide whatever
	// they held, which left a title 22 characters at 80 columns
	it('sizes each column to its widest value, never narrower than its header', () => {
		setColumns(120);
		const tasks = [
			{ ...makeTask('1', 'master'), blocks: ['2'] },
			{ ...makeTask('2', 'master'), dependencies: ['1'] }
		];

		const [, header, , first] = stripAnsi(
			createTaskTable(tasks, listOptions)
		).split('\n');

		expect(header).toContain('│ Status    │ Priority │ Deps │ Blocks │');
		expect(first).toContain('│ ○ pending │ medium   │ -    │ 2      │');
	});

	it('widens a column for a longer value, up to its old width', () => {
		setColumns(120);
		const tasks = [
			{
				...makeTask('9', 'master'),
				status: 'in-progress' as const,
				dependencies: ['1', '2', '3', '4', '5', '6', '7', '8']
			}
		];

		const [, header] = stripAnsi(createTaskTable(tasks, listOptions)).split(
			'\n'
		);

		expect(header).toContain('│ Status        │ Priority │ Deps         │');
	});

	it('hides Blocks and Complexity at 80 columns rather than cut titles under 28 characters', () => {
		setColumns(80);
		const tasks = [
			{
				...makeTask('1', 'master'),
				status: 'in-progress' as const,
				complexity: 7,
				title: 'Set up the database schema and migrations'
			}
		];

		const output = stripAnsi(createTaskTable(tasks, listOptions));

		expect(output).toContain('│ Set up the database schema and m… │');
		expect(output).toContain('│ Deps │');
		expect(output).toContain('Hidden to fit width: Blocks, Complexity');
		expect(widest(output)).toBeLessThanOrEqual(76);
	});

	it('keeps Priority and Deps at 80 columns, however long the dependency list', () => {
		setColumns(80);
		const tasks = [
			{
				...makeTask('9', 'master'),
				status: 'in-progress' as const,
				dependencies: ['1', '2', '3', '4', '5', '6', '7', '8']
			}
		];

		const output = stripAnsi(createTaskTable(tasks, listOptions));

		expect(output).toContain('│ Priority │ Deps         │');
		expect(output).toContain('Hidden to fit width: Blocks');
	});

	it('hides Blocks at 40 columns even when asked to keep it, rather than overflow', () => {
		setColumns(40);
		const task = { ...makeTask('1', 'master'), blocks: ['2'] };

		const output = stripAnsi(
			createTaskTable([task], { ...listOptions, keepBlocks: true })
		);

		expect(widest(output)).toBeLessThanOrEqual(38);
		expect(output).toContain('Blocks');
	});

	it('cuts a title only when it is longer than its cell', () => {
		setColumns(80);
		const tasks = [
			{ ...makeTask('1', 'master'), title: 'A'.repeat(200) },
			{ ...makeTask('2', 'master'), title: 'B'.repeat(10) }
		];

		const lines = stripAnsi(createTaskTable(tasks, listOptions)).split('\n');
		// Title cell text width is the column width less a space on each side
		const cellWidth = lines[1].split('│')[2].length - 2;
		const cut = lines.find((line) => line.includes('AAA')) ?? '';

		expect(cut).toContain(`${'A'.repeat(cellWidth - 1)}… │`);
		// Top border, header, header rule, one line per task, bottom border
		expect(lines.findIndex((line) => line.startsWith('└'))).toBe(
			3 + tasks.length
		);
		expect(widest(lines.join('\n'))).toBeLessThanOrEqual(76);
	});
});

describe('createTaskTable with escape sequences in task text', () => {
	it('prints titles and subtask titles without them', () => {
		const subtask = {
			id: '1',
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
