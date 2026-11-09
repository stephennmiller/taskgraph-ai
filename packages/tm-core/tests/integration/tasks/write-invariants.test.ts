/**
 * @fileoverview Every public TasksDomain writer, run on one real tasks.json,
 * keeps the invariants the rest of the code relies on
 * (.claude/rules/state-machines.md): I1-I3 (section 2), unique IDs per tag
 * and `highestId` at or above every live ID (section 4), and no GitHub issue
 * linked from two tasks (section 12). Only the AI calls are mocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isTaskComplete } from '../../../src/common/constants/index.js';
import type { TaskStatus } from '../../../src/common/types/index.js';
import { AiService } from '../../../src/modules/ai/ai-service.js';
import type { TmCore } from '../../../src/tm-core.js';
import { aiSubtask, answer } from './expand-fixtures.js';
import {
	type PrdProject,
	createPrdProject,
	existing,
	generated,
	reply
} from './parse-prd-fixture.js';

const sub = (id: number, status = 'pending') => ({
	id,
	title: `Step ${id}`,
	description: 'd',
	status,
	dependencies: [] as number[]
});

const link = (issueNumber: number) => ({
	github: {
		repo: 'o/r',
		issueNumber,
		url: `https://github.com/o/r/issues/${issueNumber}`,
		syncedAt: '2026-01-01T00:00:00.000Z',
		lastPushedStatus: 'pending',
		bodyHash: ''
	}
});

/** Every invariant holds at the start, so a violation is the writer's */
const FIXTURE = {
	master: {
		tasks: [
			existing(1, 'Base', {
				status: 'done',
				updatedAt: '2025-01-01T00:00:00.000Z'
			}),
			existing(2, 'Started parent', {
				status: 'in-progress',
				subtasks: [sub(1, 'done'), sub(2)],
				metadata: link(11)
			}),
			existing(3, 'Pending parent', { subtasks: [sub(1)] }),
			existing(4, 'Loose', { dependencies: ['1'], metadata: link(12) }),
			existing(5, 'Done parent', {
				status: 'done',
				subtasks: [sub(1, 'done')]
			})
		],
		metadata: { highestId: 5 }
	},
	feature: {
		tasks: [
			existing(1, 'Feature one', { metadata: link(21) }),
			existing(2, 'Feature parent', { subtasks: [sub(1)] })
		],
		metadata: { highestId: 2 }
	}
};

/** What breaks the invariants in a tagged tasks.json, one line each */
function violations(file: Record<string, any>): string[] {
	const found: string[] = [];
	const linked = new Map<number, string>();
	const checkLink = (item: any, where: string) => {
		const issue = item.metadata?.github?.issueNumber;
		if (issue === undefined) return;
		const other = linked.get(issue);
		if (other)
			found.push(`${where}: issue #${issue} also linked from ${other}`);
		linked.set(issue, where);
	};
	const unique = (ids: unknown[], where: string) => {
		const strings = ids.map(String);
		if (new Set(strings).size !== strings.length) {
			found.push(`${where}: an ID twice (${strings.join(', ')})`);
		}
	};
	for (const [tag, { tasks, metadata }] of Object.entries(file)) {
		unique(
			tasks.map((t: any) => t.id),
			tag
		);
		// A copied tag records none until its first write; readers then take
		// the highest live ID (highestTaskId)
		const highestId = Number(metadata?.highestId ?? Number.POSITIVE_INFINITY);
		for (const task of tasks) {
			const where = `${tag} ${task.id}`;
			if (Number(task.id) > highestId) {
				found.push(`${where}: above highestId ${highestId}`);
			}
			checkLink(task, where);
			const subs: any[] = task.subtasks ?? [];
			unique(
				subs.map((s) => s.id),
				`${where} subtasks`
			);
			const complete = subs.filter((s) =>
				isTaskComplete((s.status ?? 'pending') as TaskStatus)
			);
			if (task.status === 'done' && complete.length < subs.length) {
				found.push(`${where}: I1, done with open subtasks`);
			}
			if (
				task.status === 'in-progress' &&
				subs.length > 0 &&
				complete.length === subs.length
			) {
				found.push(`${where}: I2, in progress with every subtask complete`);
			}
			for (const s of subs) {
				if ((s.subtasks ?? []).length > 0) {
					found.push(`${where}.${s.id}: I3, a subtask with subtasks`);
				}
				checkLink(s, `${where}.${s.id}`);
			}
		}
	}
	return found;
}

type Writer = (tm: TmCore, p: PrdProject) => Promise<unknown>;

const WRITERS: Array<[string, Writer]> = [
	['add-task', (tm) => tm.tasks.add({ title: 'New', description: 'New one' })],
	[
		'add-subtask to a done parent',
		(tm) => tm.tasks.addSubtask('5', { title: 'Follow-up' })
	],
	[
		'add-subtask --task-id',
		(tm) => tm.tasks.addSubtask('3', { fromTaskId: '4' })
	],
	[
		'remove-subtask of the last open one',
		(tm) => tm.tasks.removeSubtasks(['2.2'])
	],
	[
		'remove-subtask --convert',
		(tm) => tm.tasks.removeSubtasks(['2.2'], { convert: true })
	],
	['remove-task of a subtask', (tm) => tm.tasks.removeTasks('2.2')],
	['remove-task of a parent', (tm) => tm.tasks.removeTasks('2')],
	['move a subtask to another parent', (tm) => tm.tasks.move('2.2', '3.2')],
	['move a subtask to a task', (tm) => tm.tasks.move('2.2', '9')],
	['move a task under a done parent', (tm) => tm.tasks.move('4', '5.2')],
	[
		'move a task to another tag',
		(tm) => tm.tasks.moveToTag(['2'], 'master', 'feature')
	],
	[
		'set-status of the last open subtask',
		(tm) => tm.tasks.updateStatus('2.2', 'done')
	],
	[
		'set-status of a subtask back to pending',
		(tm) => tm.tasks.updateStatus('5.1', 'pending')
	],
	[
		'set-status of several',
		(tm) => tm.tasks.updateStatuses(['3.1', '4'], 'in-progress')
	],
	[
		'update-task dropping the open subtask',
		(tm) => {
			vi.spyOn(AiService.prototype, 'generateObject').mockResolvedValue({
				mainResult: {
					task: { ...existing(2, 'Rewritten'), subtasks: [sub(1, 'done')] }
				},
				telemetryData: {},
				tagInfo: { currentTag: 'master', availableTags: ['master'] }
			} as any);
			return tm.tasks.updateWithPrompt({ id: '2', prompt: 'Drop a step' });
		}
	],
	[
		'update-subtask',
		(tm) => {
			vi.spyOn(AiService.prototype, 'generateText').mockResolvedValue({
				mainResult: 'Found the cause.',
				telemetryData: {},
				tagInfo: { currentTag: 'master' }
			} as any);
			return tm.tasks.updateSubtask({ id: '2.2', prompt: 'Note it' });
		}
	],
	[
		'expand a done task',
		(tm, p) => {
			p.generateObject.mockResolvedValue(answer() as any);
			return tm.tasks.expand({ id: '5', num: 2 });
		}
	],
	[
		'expand --force',
		(tm, p) => {
			p.generateObject.mockResolvedValue(answer([aiSubtask(1)]) as any);
			return tm.tasks.expand({ id: '3', num: 1, force: true });
		}
	],
	['clear-subtasks', (tm) => tm.tasks.clearSubtasks('2,5')],
	['tags copy', (tm) => tm.tasks.copyTag('feature', 'copy')],
	['tags rename', (tm) => tm.tasks.renameTag('feature', 'later')],
	['tags delete', (tm) => tm.tasks.deleteTag('feature')],
	['archive', (tm) => tm.tasks.archive({ olderThanDays: 30 })],
	[
		'archive, then restore',
		async (tm) => {
			await tm.tasks.archive({ olderThanDays: 30 });
			return tm.tasks.restore('1');
		}
	],
	[
		'parse-prd --append',
		(tm, p) => {
			p.generateObject.mockResolvedValue(
				reply([generated(1), generated(2, { dependencies: [1] })]) as any
			);
			return tm.tasks.parsePrd({ prdPath: p.prdPath, append: true });
		}
	]
];

describe('every TasksDomain writer keeps the tasks.json invariants', () => {
	let p: PrdProject;

	beforeEach(async () => {
		p = await createPrdProject({ analysis: false });
		p.write(FIXTURE);
	});

	afterEach(async () => {
		await p.close();
	});

	it('starts from a file that keeps them', () => {
		expect(violations(p.read())).toEqual([]);
	});

	it.each(WRITERS)('%s', async (_name, write) => {
		const before = JSON.stringify(p.read());

		await write(p.tmCore, p);

		expect(JSON.stringify(p.read())).not.toBe(before);
		expect(violations(p.read())).toEqual([]);
	});
});

describe('a parent marked done over open subtasks (#1107)', () => {
	let p: PrdProject;
	const parent = () => p.read().master.tasks[0];

	beforeEach(async () => {
		p = await createPrdProject({ analysis: false });
		p.write({
			master: {
				tasks: [
					existing(1, 'Parent', {
						status: 'done',
						subtasks: [sub(1), sub(2), sub(3)]
					}),
					existing(2, 'Next', { dependencies: ['1'] })
				],
				metadata: { highestId: 2 }
			}
		});
	});

	afterEach(async () => {
		await p.close();
	});

	it.each<[string, Writer]>([
		['set-status cancelled', (tm) => tm.tasks.updateStatus('1.1', 'cancelled')],
		['remove-task of a subtask', (tm) => tm.tasks.removeTasks('1.1')],
		['remove-subtask', (tm) => tm.tasks.removeSubtasks(['1.1'])],
		['move of a subtask to a task', (tm) => tm.tasks.move('1.1', '9')]
	])(
		'stays done after %s, and after the rest are cancelled',
		async (_name, write) => {
			await write(p.tmCore, p);

			expect(parent().status).toBe('done');
			await p.tmCore.tasks.updateStatuses(['1.2', '1.3'], 'cancelled');
			expect(parent().status).toBe('done');
			expect((await p.tmCore.tasks.getNext())?.id).not.toBe('1');
		}
	);

	it('reopens when a leftover subtask is started', async () => {
		await p.tmCore.tasks.updateStatus('1.1', 'in-progress');

		expect(parent().status).toBe('in-progress');
	});
});
