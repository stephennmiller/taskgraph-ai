/**
 * @fileoverview Session context for coding agents (`taskgraph prime`)
 * What an agent needs at the start of a session, or after its context is
 * compacted: the task in progress and how to tell it's done, the next few
 * ready tasks, and the workflow rules. This is the single source of those
 * rules; the agent guide init writes only points here.
 */

import type { Task } from '../../../common/types/index.js';
import { rankNextTasks } from './next-task.js';

/** One workflow rule: what to do, and the command that does it */
export interface PrimeRule {
	text: string;
	command: string;
}

/**
 * The five rules an agent follows while working a task. Each command must be
 * one the CLI registers; tests/unit/taskgraph-claude-md-drift.test.ts checks.
 */
export const PRIME_RULES: readonly PrimeRule[] = [
	{
		text: 'Claim a task before you start it',
		command: 'taskgraph set-status --id=<id> --status=in-progress'
	},
	{
		text: 'Log what you did and decided as you go',
		command: 'taskgraph update-task --id=<id> --append --prompt="<note>"'
	},
	{
		text: 'File work you find as a new task instead of doing it now',
		command: 'taskgraph add-task --prompt="<what you found>"'
	},
	{
		text: 'Check the done-when criteria and run the tests, then close it',
		command: 'taskgraph set-status --id=<id> --status=done'
	},
	{
		text: 'Commit with the task ID in the message',
		command: 'git commit -m "<type>: <change> (task <id>)"'
	}
];

/** A task or subtask as prime shows it. Subtask IDs are dotted ("3.2"). */
export interface PrimeTask {
	id: string;
	title: string;
	status: string;
	priority: string;
	/** The parent task's title, for a subtask */
	parentTitle?: string;
}

export interface PrimeInProgressTask extends PrimeTask {
	/**
	 * How to tell the task is done: its acceptance criteria, or its test
	 * strategy when it has none. Empty when the task states neither.
	 */
	doneWhen: string[];
}

export interface PrimeContext {
	tag: string;
	counts: { total: number; done: number };
	/** In-progress subtasks, then in-progress tasks with none of their own */
	inProgress: PrimeInProgressTask[];
	/** Up to `readyLimit` pending tasks or subtasks, in `next` order */
	ready: PrimeTask[];
	rules: readonly PrimeRule[];
}

export interface BuildPrimeContextOptions {
	tag: string;
	/** How many ready tasks to include (default 3) */
	readyLimit?: number;
}

const isDone = (status: string | undefined) =>
	status === 'done' || status === 'completed' || status === 'cancelled';

/** Acceptance criteria if any, else the test strategy, else nothing */
function doneWhen(item: {
	acceptanceCriteria?: string[];
	testStrategy?: string;
}): string[] {
	const criteria = (item.acceptanceCriteria ?? [])
		.map((c) => c.trim())
		.filter(Boolean);
	if (criteria.length > 0) return criteria;
	const strategy = item.testStrategy?.trim();
	return strategy ? [strategy] : [];
}

/**
 * Build the prime context for one tag's tasks. Pure: reads nothing, prints
 * nothing, and keeps titles and criteria whole (the CLI cuts them to fit).
 */
export function buildPrimeContext(
	tasks: Task[],
	options: BuildPrimeContextOptions
): PrimeContext {
	const readyLimit = options.readyLimit ?? 3;

	const inProgressSubtasks: PrimeInProgressTask[] = [];
	const inProgressTasks: PrimeInProgressTask[] = [];
	for (const task of tasks) {
		const subtasks = (task.subtasks ?? []).filter(
			(st) => st.status === 'in-progress'
		);
		for (const st of subtasks) {
			inProgressSubtasks.push({
				id: `${task.id}.${st.id}`,
				title: st.title,
				status: st.status,
				priority: st.priority || task.priority || 'medium',
				parentTitle: task.title,
				doneWhen: doneWhen(st)
			});
		}
		if (task.status === 'in-progress' && subtasks.length === 0) {
			inProgressTasks.push({
				id: String(task.id),
				title: task.title,
				status: task.status,
				priority: task.priority || 'medium',
				doneWhen: doneWhen(task)
			});
		}
	}

	const titles = new Map(tasks.map((t) => [String(t.id), t.title]));
	const ready = rankNextTasks(tasks)
		.filter((t) => (t.status || 'pending') === 'pending')
		.slice(0, readyLimit)
		.map((t): PrimeTask => {
			const parentId = (t as Task & { parentId?: string }).parentId;
			return {
				id: String(t.id),
				title: t.title,
				status: t.status || 'pending',
				priority: t.priority || 'medium',
				...(parentId ? { parentTitle: titles.get(parentId) } : {})
			};
		});

	return {
		tag: options.tag,
		counts: {
			total: tasks.length,
			done: tasks.filter((t) => isDone(t.status)).length
		},
		inProgress: [...inProgressSubtasks, ...inProgressTasks],
		ready,
		rules: PRIME_RULES
	};
}
