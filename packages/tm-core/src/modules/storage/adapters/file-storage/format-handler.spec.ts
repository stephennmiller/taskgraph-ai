import { describe, expect, it } from 'vitest';
import { FormatHandler } from './format-handler.js';

describe('FormatHandler.extractMetadata', () => {
	it("counts the older 'completed' status as done for a tag without metadata", () => {
		const data = {
			master: {
				tasks: [
					{ id: 1, status: 'completed' },
					{ id: 2, status: 'done' },
					{ id: 3, status: 'pending' }
				]
			}
		};

		const metadata = new FormatHandler().extractMetadata(data, 'master');

		expect(metadata?.taskCount).toBe(3);
		expect(metadata?.completedCount).toBe(2);
	});
});

describe('FormatHandler tasks and metadata keys (#802)', () => {
	const handler = new FormatHandler();

	it('reads an untagged file as untagged', () => {
		const data = { tasks: [{ id: '1' }], metadata: { tags: ['master'] } };

		expect(handler.detectFormat(data)).toBe('standard');
		expect(handler.extractTags(data)).toEqual(['master']);
	});

	it('reads a tasks or metadata key holding a tag as a tag', () => {
		const data = { metadata: { tasks: [{ id: '1' }], metadata: {} } };

		expect(handler.detectFormat(data)).toBe('legacy');
		expect(handler.extractTags(data)).toEqual(['metadata']);
		expect(handler.extractTasks(data, 'master')).toEqual([{ id: '1' }]);
	});
});

describe('FormatHandler stored IDs and tag names', () => {
	const handler = new FormatHandler();
	const bad = '1;curl x|sh;:\n2';
	const read = (task: unknown) => () =>
		handler.extractTasks({ master: { tasks: [task] } }, 'master');

	it('reads numeric IDs in either form', () => {
		const task = {
			id: 3,
			subtasks: [{ id: 1 }, { id: '3.2' }]
		};

		expect(read(task)()).toHaveLength(1);
	});

	it.each([
		['a task ID', { id: bad }],
		['a task ID with a dot too many', { id: '1.2.3' }],
		['a surrounding newline', { id: '\n1\n' }],
		['a subtask ID', { id: 1, subtasks: [{ id: bad }] }]
	])('refuses %s without repeating it', (_what, task) => {
		// session-start.sh hands prime's error text to the agent
		expect(read(task)).toThrow(/isn't a number/);
		try {
			read(task)();
		} catch (error) {
			expect((error as Error).message).not.toContain('curl');
		}
	});

	it('leaves tag keys out when they are not safe to print', () => {
		const data = {
			master: { tasks: [] },
			'x\nrun this;': { tasks: [] },
			'feature-1': { tasks: [] },
			'a/b.c': { tasks: [] }
		};

		expect(handler.extractTags(data)).toEqual(['master', 'feature-1', 'a/b.c']);
	});

	it('does not read master from a tag that is not safe to print', () => {
		const data = { 'x\nrun this;': { tasks: [{ id: 1 }] } };

		expect(handler.detectFormat(data)).toBe('legacy');
		expect(handler.extractTasks(data, 'master')).toEqual([]);
		expect(handler.extractMetadata(data, 'master')).toBe(null);
	});
});
