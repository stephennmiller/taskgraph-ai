import { describe, expect, it } from 'vitest';
import type { Task } from '../../common/types/index.js';
import { selectNextTask } from '../tasks/utils/next-task.js';
import { blockedCount, criticalPath, findCycles } from './dependency-graph.js';
import { withoutReservedMetadata } from './dependency-provenance.js';
import { explainBlockers } from './explain-blockers.js';
import {
	findDanglingLinks,
	getLinkType,
	getTaskLinks,
	parseLinkType,
	pruneTaskLinks,
	removeTaskLink,
	retargetTaskLinks,
	setTaskLink
} from './task-links.js';
import { retargetDependents } from './task-to-subtask.js';

const task = (
	id: number,
	// Stored files hold numbers and plain subtasks, so fields are loose here
	fields: Record<string, any> = {}
): Task =>
	({
		id,
		title: `Task ${id}`,
		description: '',
		status: 'pending',
		priority: 'medium',
		dependencies: [],
		details: '',
		testStrategy: '',
		subtasks: [],
		...fields
	}) as unknown as Task;

const linked = (links: Record<string, string>) => ({
	metadata: { taskLinks: links }
});

describe('parseLinkType', () => {
	it('reads no type as blocks, so existing calls keep blocking', () => {
		expect(parseLinkType(undefined)).toBe('blocks');
		expect(parseLinkType('')).toBe('blocks');
	});

	it('accepts the three types in any case', () => {
		expect(parseLinkType('related')).toBe('related');
		expect(parseLinkType('Discovered-From')).toBe('discovered-from');
		expect(parseLinkType('blocks')).toBe('blocks');
	});

	it('rejects anything else', () => {
		expect(parseLinkType('relates')).toBeUndefined();
		expect(parseLinkType(3)).toBeUndefined();
	});
});

describe('reading links', () => {
	it('treats a file without links as all blocks', () => {
		const legacy = task(2, {
			dependencies: [1],
			metadata: { dependencySources: { '1': 'inferred' } }
		});

		expect(getTaskLinks(legacy)).toEqual([]);
		expect(getLinkType(legacy, 1)).toBe('blocks');
		expect(getLinkType(legacy, 3)).toBeUndefined();
	});

	it('lists related links first, then discovered-from, each by ID', () => {
		const t = task(
			5,
			linked({ '10': 'related', '3': 'discovered-from', '2': 'related' })
		);

		expect(getTaskLinks(t)).toEqual([
			{ id: '2', type: 'related' },
			{ id: '10', type: 'related' },
			{ id: '3', type: 'discovered-from' }
		]);
	});

	it('skips malformed entries', () => {
		const t = task(5, {
			metadata: { taskLinks: { '1': 'blocks', '2': 7, '3': 'related' } }
		});

		expect(getTaskLinks(t)).toEqual([{ id: '3', type: 'related' }]);
	});

	it('lets a dependency on the same task win over a link', () => {
		const t = task(5, { dependencies: [3], ...linked({ '3': 'related' }) });

		expect(getTaskLinks(t)).toEqual([]);
		expect(getLinkType(t, 3)).toBe('blocks');
	});

	it("resolves a subtask's sibling dependency before comparing", () => {
		const subtask = {
			id: 2,
			dependencies: [1],
			...linked({ '4.1': 'related' })
		};

		expect(getTaskLinks(subtask, 4)).toEqual([]);
	});
});

describe('writing links', () => {
	it('adds, replaces and removes a link, keeping other metadata', () => {
		let metadata = setTaskLink({ owner: 'sam' }, 3, 'related');
		expect(metadata).toEqual({ owner: 'sam', taskLinks: { '3': 'related' } });

		metadata = setTaskLink(metadata, '3', 'discovered-from');
		expect(metadata).toEqual({
			owner: 'sam',
			taskLinks: { '3': 'discovered-from' }
		});

		expect(removeTaskLink(metadata, 3)).toEqual({ owner: 'sam' });
		expect(
			removeTaskLink({ taskLinks: { '3': 'related' } }, 3)
		).toBeUndefined();
	});

	it('is reserved, so --metadata on update cannot overwrite it', () => {
		expect(
			withoutReservedMetadata({ taskLinks: { '1': 'related' }, owner: 'sam' })
		).toEqual({ owner: 'sam' });
	});
});

describe('non-blocking links never block', () => {
	const tasks = [
		task(1),
		task(2, { priority: 'high', ...linked({ '1': 'related' }) }),
		task(3, { ...linked({ '2': 'discovered-from' }) })
	];

	it('next picks a task whose only links are to pending tasks', () => {
		expect(selectNextTask(tasks)?.id).toBe(2);
	});

	it('why reports it unblocked', () => {
		const why = explainBlockers(tasks, '2');
		expect(why.blocked).toBe(false);
		expect(why.blockers).toEqual([]);
		expect(explainBlockers(tasks, '3').blockers).toEqual([]);
	});

	it('adds nothing to blocked counts, the critical path or loop checks', () => {
		const loop = [
			task(1, linked({ '2': 'related' })),
			task(2, linked({ '1': 'related' }))
		];

		expect(findCycles(loop)).toEqual([]);
		expect(blockedCount(tasks).get('1')).toBe(0);
		expect(criticalPath(tasks).length).toBeLessThanOrEqual(1);
	});
});

describe('retargetTaskLinks', () => {
	it('follows a renumbered task, and its subtasks when asked', () => {
		const tasks = [
			task(1, linked({ '8': 'related', '8.2': 'discovered-from' })),
			task(9, { subtasks: [{ id: 1, ...linked({ '8': 'related' }) }] })
		];

		retargetTaskLinks(tasks, 8, 12, { withSubtasks: true });

		expect(tasks[0].metadata).toEqual({
			taskLinks: { '12': 'related', '12.2': 'discovered-from' }
		});
		expect(tasks[1].subtasks[0].metadata).toEqual({
			taskLinks: { '12': 'related' }
		});
	});

	it('leaves links to the subtasks alone without withSubtasks', () => {
		const tasks = [task(1, linked({ '8.2': 'related' }))];

		retargetTaskLinks(tasks, 8, 12);

		expect(tasks[0].metadata).toEqual({ taskLinks: { '8.2': 'related' } });
	});

	it('is part of retargetDependents, used by every move that renames', () => {
		const tasks = [
			task(1, linked({ '5.3': 'related' })),
			task(5, { subtasks: [{ id: 3, title: 's' }] })
		];

		retargetDependents(tasks as any, '5.3', 9);

		expect(tasks[0].metadata).toEqual({ taskLinks: { '9': 'related' } });
	});

	it('drops a link that would point at its own task', () => {
		const tasks = [task(1, linked({ '4': 'related' }))];

		retargetTaskLinks(tasks, 4, 1);

		expect(tasks[0].metadata).toBeUndefined();
	});
});

describe('pruneTaskLinks', () => {
	it('drops links to tasks and subtasks that no longer exist', () => {
		const tasks = [
			task(1, linked({ '2': 'related', '7': 'related', '2.9': 'related' })),
			task(2, {
				subtasks: [{ id: 1, ...linked({ '7.1': 'discovered-from' }) }]
			})
		];

		const dropped = pruneTaskLinks(tasks);

		expect(dropped).toEqual([
			{ taskId: '1', linkedId: '7', type: 'related' },
			{ taskId: '1', linkedId: '2.9', type: 'related' },
			{ taskId: '2.1', linkedId: '7.1', type: 'discovered-from' }
		]);
		expect(tasks[0].metadata).toEqual({ taskLinks: { '2': 'related' } });
		expect(tasks[1].subtasks[0].metadata).toBeUndefined();
		expect(findDanglingLinks(tasks)).toEqual([]);
	});

	it('takes a custom test of which IDs exist', () => {
		const tasks = [task(1, linked({ '2': 'related', '3': 'related' }))];

		pruneTaskLinks(tasks, (id) => id === '3');

		expect(tasks[0].metadata).toEqual({ taskLinks: { '3': 'related' } });
	});
});
