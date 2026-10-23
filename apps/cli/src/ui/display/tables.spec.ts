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
