/**
 * @fileoverview The task context an AI prompt gets: the tasks that match a
 * query (fuzzy search over titles, descriptions and details, plus the newest
 * tasks) and the dependency chains of given tasks, formatted as the legacy
 * ContextGatherer's 'research' format (`scripts/modules/utils/contextGatherer.js`).
 */

import type { Subtask, Task } from '../../common/types/index.js';

export interface TaskContextOptions {
	/** Text to match tasks against (the user's prompt) */
	query?: string;
	/** How many matching tasks go into the context */
	maxResults?: number;
	/** Tasks whose dependency chains go into the context */
	dependencyIds?: Array<string | number>;
}

export interface TaskContext {
	/** The formatted context, empty when there is none */
	context: string;
	/** Every task the search matched, best first, then the newest ones */
	relevantTasks: Task[];
}

const truncate = (text: string, max: number) =>
	text.length <= max ? text : `${text.slice(0, max - 3)}...`;

/** Fuzzy matches for `query`, then the five newest tasks, best first */
async function searchTasks(tasks: Task[], query: string): Promise<Task[]> {
	const { default: Fuse } = await import('fuse.js');
	const byId = new Map(tasks.map((t) => [String(t.id), t]));
	const searchable = tasks.map((task) => ({
		...task,
		dependencyTitles: (task.dependencies ?? [])
			.map((id) => byId.get(String(id))?.title)
			.filter(Boolean)
			.join(' ')
	}));
	const fuse = new Fuse(searchable, {
		includeScore: true,
		threshold: 0.4,
		keys: [
			{ name: 'title', weight: 1.5 },
			{ name: 'description', weight: 2 },
			{ name: 'details', weight: 3 },
			{ name: 'dependencyTitles', weight: 0.5 }
		],
		shouldSort: true,
		useExtendedSearch: true
	});

	const results = fuse.search(query);
	// Each long word of the query too, to catch its different aspects
	const words = query
		.toLowerCase()
		.replace(/[^\w\s-]/g, ' ')
		.split(/\s+/)
		.filter((word) => word.length > 5);
	for (const word of words) {
		for (const hit of fuse.search(word)) {
			if (!results.some((r) => r.item.id === hit.item.id)) results.push(hit);
		}
	}

	const relevant: Task[] = [];
	const add = (task: Task) => {
		if (!relevant.some((t) => String(t.id) === String(task.id))) {
			relevant.push(byId.get(String(task.id)) ?? task);
		}
	};
	const score = (r: (typeof results)[number]) => r.score ?? 1;
	results.filter((r) => score(r) < 0.25).forEach((r) => add(r.item));
	results
		.filter((r) => score(r) >= 0.25 && score(r) < 0.4)
		.forEach((r) => add(r.item));
	[...tasks]
		.sort((a, b) => Number(b.id) - Number(a.id))
		.slice(0, 5)
		.forEach(add);
	return relevant;
}

/** IDs of the given tasks and everything they depend on, 5 levels deep */
function dependencyChainIds(tasks: Task[], ids: Array<string | number>) {
	const visited = new Set<string>();
	const visit = (id: string | number, depth: number) => {
		const key = String(id);
		if (visited.has(key) || depth > 5) return;
		const task = tasks.find((t) => String(t.id) === key);
		if (!task) return;
		visited.add(key);
		for (const dep of task.dependencies ?? []) visit(dep, depth + 1);
	};
	for (const id of ids) visit(id, 0);
	return visited;
}

function formatTask(task: Task): string {
	const lines = [
		`**Task ${task.id}: ${task.title}**`,
		`Description: ${task.description}`,
		`Status: ${task.status || 'pending'}`,
		`Priority: ${task.priority || 'medium'}`
	];
	if (task.dependencies?.length) {
		lines.push(`Dependencies: ${task.dependencies.join(', ')}`);
	}
	if (task.details) {
		lines.push(`Implementation Details: ${truncate(task.details, 500)}`);
	}
	if (task.testStrategy) {
		lines.push(`Test Strategy: ${truncate(task.testStrategy, 300)}`);
	}
	if (task.subtasks?.length) {
		lines.push(`Subtasks: ${task.subtasks.length} subtasks defined`);
	}
	return lines.join('\n');
}

function formatSubtask(subtask: Subtask, parent: Task): string {
	const lines = [
		`**Subtask ${parent.id}.${subtask.id}: ${subtask.title}**`,
		`Parent Task: ${parent.title}`,
		`Description: ${subtask.description}`,
		`Status: ${subtask.status || 'pending'}`
	];
	if (subtask.dependencies?.length) {
		lines.push(`Dependencies: ${subtask.dependencies.join(', ')}`);
	}
	if (subtask.details) {
		lines.push(`Implementation Details: ${truncate(subtask.details, 500)}`);
	}
	return lines.join('\n');
}

/** The task ("3"), or the subtask ("3.2") and its parent, if it exists */
export function findTaskOrSubtask(
	tasks: Task[],
	id: string
): { parent: Task; subtask?: Subtask } | undefined {
	const [parentId, subId] = id.split('.');
	const parent = tasks.find((t) => String(t.id) === parentId);
	if (!parent || subId === undefined) return parent && { parent };
	const subtask = parent.subtasks?.find((s) => String(s.id) === subId);
	return subtask && { parent, subtask };
}

/** A task ("3") or subtask ("3.2") formatted for the context, if it exists */
function formatById(tasks: Task[], id: string): string | null {
	const found = findTaskOrSubtask(tasks, id);
	if (!found) return null;
	return found.subtask
		? formatSubtask(found.subtask, found.parent)
		: formatTask(found.parent);
}

/**
 * Build the task context for a prompt from one tag's tasks.
 * Task IDs are compared as strings: tm-core stores "3", older files 3.
 */
export async function gatherTaskContext(
	tasks: Task[],
	{ query, maxResults = 10, dependencyIds = [] }: TaskContextOptions
): Promise<TaskContext> {
	const ids = new Set<string>();
	let relevantTasks: Task[] = [];
	if (query && tasks.length > 0) {
		relevantTasks = await searchTasks(tasks, query);
		for (const task of relevantTasks.slice(0, maxResults)) {
			ids.add(String(task.id));
		}
	}
	for (const id of dependencyChainIds(tasks, dependencyIds)) ids.add(id);

	const items = [...ids]
		.map((id) => formatById(tasks, id))
		.filter((item): item is string => item !== null);
	return {
		context: items.length
			? `## Task Context\n\n${items.join('\n\n---\n\n')}`
			: '',
		relevantTasks
	};
}
