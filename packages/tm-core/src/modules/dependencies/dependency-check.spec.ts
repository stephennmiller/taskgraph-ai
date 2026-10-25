/**
 * validate-dependencies and fix-dependencies on tasks as stored: number IDs
 * (older files) and string IDs (what tm-core saves) alike. Loops are found in
 * one pass (strongly connected components); the random-project tests check
 * that against a plain search per ID.
 */

import { describe, expect, it } from 'vitest';
import type { Task } from '../../common/types/index.js';
import {
	breakSubtaskLoops,
	countTasksAndDependencies,
	createDependencyState,
	createTaskLookup,
	fixTaskDependencies,
	validateTaskDependencies
} from './dependency-check.js';
import { resolveSubtaskDependency } from './subtask-dependency.js';

type Id = string | number;
type Raw = Record<string, any>;

const task = (id: Id, dependencies: Id[] = [], subtasks?: Raw[]): Raw => ({
	id,
	title: `Task ${id}`,
	status: 'pending',
	dependencies,
	...(subtasks ? { subtasks } : {})
});
const subtask = (id: Id, dependencies: Id[] = []): Raw => ({
	id,
	title: `Subtask ${id}`,
	status: 'pending',
	dependencies
});
const asTasks = (tasks: Raw[]) => tasks as unknown as Task[];
const validate = (tasks: Raw[], archived: string[] = []) =>
	validateTaskDependencies(asTasks(tasks), new Set(archived));
const fix = (tasks: Raw[], archived: string[] = []) =>
	fixTaskDependencies(asTasks(tasks), new Set(archived));

describe('validateTaskDependencies', () => {
	it('reports a self-dependency once, not again as a loop', () => {
		const { issues } = validate([task(1), task(4, [4])]);
		expect(issues.map((issue) => issue.type)).toEqual(['self']);
	});

	it('reads a bare number in a subtask as a sibling subtask', () => {
		const { issues } = validate([task(1, [], [subtask(1, [7])]), task(7)]);
		expect(issues).toEqual([
			expect.objectContaining({
				type: 'missing',
				taskId: '1.1',
				dependencyId: '1.7'
			})
		]);
	});

	it('reads a number of 100 or more in a subtask as a task', () => {
		const { issues } = validate([
			task(150),
			task(1, [], [subtask(1, [150]), subtask(2, [151])])
		]);
		expect(issues).toEqual([
			expect.objectContaining({
				type: 'missing',
				taskId: '1.2',
				dependencyId: 151
			})
		]);
	});

	it('reports only the tasks in a loop, not ones that depend on it', () => {
		const { issues } = validate([
			task(1, [2]),
			task(2, [3]),
			task(3, [2]),
			task(4, [], [subtask(1, ['2'])])
		]);
		expect(issues.map((issue) => [issue.taskId, issue.fixable])).toEqual([
			[2, false],
			[3, false]
		]);
	});

	it('marks a loop made only of subtasks as one fix can break', () => {
		const { issues } = validate([
			task(1, [], [subtask(1, [2]), subtask(2, [1])])
		]);
		expect(issues.map((issue) => [issue.taskId, issue.fixable])).toEqual([
			['1.1', true],
			['1.2', true]
		]);
	});

	it("marks a subtask loop through a task as one fix can't break", () => {
		const { issues } = validate([task(1, ['1.1'], [subtask(1, ['1'])])]);
		expect(issues.map((issue) => [issue.taskId, issue.fixable])).toEqual([
			[1, false],
			['1.1', false]
		]);
	});

	it('still finds a loop for a task that also depends on itself', () => {
		const { issues } = validate([task(1), task(2, [2, 3]), task(3, [2])]);
		expect(issues.map((issue) => [issue.type, issue.taskId])).toEqual([
			['self', 2],
			['circular', 2],
			['circular', 3]
		]);
	});

	it('reads a file with string IDs, as tm-core saves it', () => {
		const { issues } = validate([
			task('1'),
			task('2', ['1', '99'], [subtask(1, ['1']), subtask(2, [1])])
		]);
		expect(issues).toEqual([
			expect.objectContaining({
				type: 'missing',
				taskId: '2',
				dependencyId: '99'
			})
		]);
	});

	it('counts a dependency on an archived task, or its subtask, as done', () => {
		const { valid } = validate([task(3, [1], [subtask(1, ['1.1'])])], ['1']);
		expect(valid).toBe(true);
	});

	it('reports a link to a missing task, not the healthy links', () => {
		const { issues } = validate([
			task(1),
			{ ...task(2), metadata: { taskLinks: { 1: 'related', 9: 'related' } } }
		]);
		expect(issues).toEqual([
			expect.objectContaining({
				type: 'missing-link',
				taskId: '2',
				dependencyId: '9'
			})
		]);
	});
});

describe('fixTaskDependencies', () => {
	it("removes a task's dependency on itself as well as missing ones", () => {
		const tasks = [task(1), task(4, [99, 4])];

		const result = fix(tasks);

		expect(result.fixes).toEqual([
			{ type: 'missing', taskId: 4, dependencyId: 99 },
			{ type: 'self', taskId: 4 }
		]);
		expect(result.remaining).toEqual([]);
		expect(tasks[1].dependencies).toEqual([]);
	});

	it('breaks a loop between subtasks by removing one edge', () => {
		const tasks = [task(1, [], [subtask(1), subtask(2, [3]), subtask(3, [2])])];

		const result = fix(tasks);

		expect(result.fixes).toEqual([
			{ type: 'circular', taskId: '1.2', dependencyId: '1.3' }
		]);
		expect(result.remaining).toEqual([]);
		expect(tasks[0].subtasks.map((s: Raw) => s.dependencies)).toEqual([
			[],
			[],
			[2]
		]);
	});

	it('keeps a subtask dependency on a task, by string or by a number of 100+', () => {
		const tasks = [task(1, [], [subtask(1, ['2', 150])]), task(2), task(150)];
		const before = structuredClone(tasks);

		expect(fix(tasks).fixes).toEqual([]);
		expect(tasks).toEqual(before);
	});

	it('leaves a loop between tasks for the user and reports it', () => {
		const result = fix([task(1), task(2, [3]), task(3, [2])]);

		expect(result.fixes).toEqual([]);
		expect(result.remaining.map((issue) => [issue.type, issue.taskId])).toEqual(
			[
				['circular', 2],
				['circular', 3]
			]
		);
	});

	it('names a non-numeric dependency as written, not NaN', () => {
		expect(fix([task(1, [], [subtask(1, ['abc'])])]).fixes).toEqual([
			{ type: 'missing', taskId: '1.1', dependencyId: 'abc' }
		]);
	});

	it('removes duplicates: "1" and 1 on a task, 1 and "2.1" on a subtask', () => {
		const tasks = [
			task(1),
			task(2, [1, '1'], [subtask(1), subtask(2, [1, '2.1'])])
		];

		const result = fix(tasks);

		expect(result.fixes).toEqual([
			{ type: 'duplicate', taskId: 2, dependencyId: '1' },
			{ type: 'duplicate', taskId: '2.2', dependencyId: '2.1' }
		]);
		expect(countTasksAndDependencies(asTasks(tasks))).toEqual({
			taskCount: 2,
			subtaskCount: 2,
			dependencyCount: 2
		});
	});

	it('works on string IDs, as tm-core saves them', () => {
		const tasks = [task('1'), task('2', ['1', '9'])];

		expect(fix(tasks).fixes).toEqual([
			{ type: 'missing', taskId: '2', dependencyId: '9' }
		]);
		expect(tasks[1].dependencies).toEqual(['1']);
	});

	it('keeps dependencies on archived tasks and removes missing ones', () => {
		const tasks = [
			task(3, [1, 9], [subtask(1, ['1.1', '9.1'])]),
			{ ...task(4), metadata: { taskLinks: { 1: 'related', 9: 'related' } } }
		];

		const { fixes } = fix(tasks, ['1']);

		expect(fixes).toEqual([
			{ type: 'missing', taskId: 3, dependencyId: 9 },
			{ type: 'missing', taskId: '3.1', dependencyId: '9.1' },
			{ type: 'missing-link', taskId: '4', dependencyId: '9' }
		]);
		expect(tasks[0].dependencies).toEqual([1]);
		expect(tasks[0].subtasks[0].dependencies).toEqual(['1.1']);
		expect(tasks[1].metadata).toEqual({ taskLinks: { 1: 'related' } });
	});

	it('prunes the inferred mark of a dependency it removes', () => {
		const tasks = [
			task(1),
			{
				...task(3, [1, 99]),
				metadata: {
					jira: 'ABC-1',
					dependencySources: { 1: 'inferred', 99: 'inferred' }
				}
			}
		];

		fix(tasks);

		expect(tasks[1].metadata).toEqual({
			jira: 'ABC-1',
			dependencySources: { 1: 'inferred' }
		});
	});
});

describe('createTaskLookup', () => {
	it('finds tasks and subtasks by number or string ID, the first task winning', () => {
		const exists = createTaskLookup(
			asTasks([
				{ id: 1, subtasks: [{ id: 1 }, { id: 2 }] },
				{ id: 1, subtasks: [{ id: 9 }] },
				{ id: '4', subtasks: [{ id: '1' }] },
				{ id: 3, subtasks: [] }
			])
		);

		for (const id of [1, '1', '01', '1.1', '1.2', '1.2.3', '4', '4.1']) {
			expect(exists(id), `id ${id}`).toBe(true);
		}
		for (const id of [0, '', '2', '1.9', '3.1', '3.y', 'x.1', 'x', '.1']) {
			expect(exists(id), `id ${id}`).toBe(false);
		}
	});
});

describe('createDependencyState', () => {
	const as = (status: string | undefined, raw: Raw) => ({ ...raw, status });
	const state = createDependencyState(
		asTasks([
			task(1, [], [subtask(1), as('done', subtask(2))]),
			as('cancelled', task(2, [], [subtask(1)])),
			as('deferred', task(3, [], [subtask(1)])),
			task('4', [], [as(undefined, subtask('1'))]),
			as('done', task(5))
		])
	);

	it.each([
		['2', '1.1', 'open'],
		['2', '1.2', 'satisfied'],
		// a subtask of a cancelled task never runs
		['9', '2.1', 'satisfied'],
		['9', '3.1', 'open'],
		// a task's own subtask runs inside it; a sibling's doesn't count
		['1', '1.1', 'satisfied'],
		['1.2', '1.1', 'open'],
		// number IDs in the file, a subtask with no status
		['9', '4.1', 'open'],
		['9', '5', 'satisfied'],
		['9', '1', 'open'],
		['9', '1.9', 'missing'],
		['9', '6', 'missing'],
		['9', '6.1', 'missing']
	])('%s on %s is %s', (taskId, depId, expected) => {
		expect(state(taskId, depId)).toBe(expected);
	});
});

// ----- Against a plain search per ID, on random projects -----

/** Small deterministic generator, so a failure can be reproduced */
function random(seed: number) {
	let state = seed;
	return () => {
		state = (state * 1664525 + 1013904223) % 4294967296;
		return state / 4294967296;
	};
}

function edges(tasks: Raw[], subtasksOnly = false): Map<string, string[]> {
	const graph = new Map<string, string[]>();
	const add = (id: string, deps: string[]) =>
		graph.set(
			id,
			deps.filter((d) => d !== id && (!subtasksOnly || d.includes('.')))
		);
	for (const t of tasks) {
		if (!subtasksOnly) add(String(t.id), (t.dependencies ?? []).map(String));
		for (const s of t.subtasks ?? []) {
			add(
				`${t.id}.${s.id}`,
				(s.dependencies ?? []).map((d: Id) => resolveSubtaskDependency(t.id, d))
			);
		}
	}
	return graph;
}

function inLoopBySearch(graph: Map<string, string[]>, id: string): boolean {
	const seen = new Set<string>();
	const stack = [...(graph.get(id) ?? [])];
	while (stack.length > 0) {
		const next = stack.pop() as string;
		if (next === id) return true;
		if (seen.has(next)) continue;
		seen.add(next);
		stack.push(...(graph.get(next) ?? []));
	}
	return false;
}

function exists(tasks: Raw[], id: Id): boolean {
	if (!id) return false;
	if (typeof id === 'string' && id.includes('.')) {
		const [p, s] = id.split('.').map((n) => parseInt(n, 10));
		const parent = tasks.find((t) => String(t.id) === String(p));
		return Boolean(
			parent?.subtasks?.some((st: Raw) => String(st.id) === String(s))
		);
	}
	const n = parseInt(String(id), 10);
	return tasks.some((t) => String(t.id) === String(n));
}

function validateBySearch(tasks: Raw[]) {
	const issues: Raw[] = [];
	const graph = edges(tasks);
	const subtaskGraph = edges(tasks, true);
	for (const t of tasks) {
		if (!t.dependencies) continue;
		for (const dep of t.dependencies) {
			if (String(dep) === String(t.id)) {
				issues.push({ type: 'self', taskId: t.id });
			} else if (!exists(tasks, dep)) {
				issues.push({ type: 'missing', taskId: t.id, dependencyId: dep });
			}
		}
		if (inLoopBySearch(graph, String(t.id))) {
			issues.push({ type: 'circular', taskId: t.id, fixable: false });
		}
		for (const s of t.subtasks ?? []) {
			if (!s.dependencies) continue;
			const fullId = `${t.id}.${s.id}`;
			for (const dep of s.dependencies) {
				const sibling = typeof dep === 'number' && dep < 100;
				if (String(dep) === fullId || (sibling && dep === s.id)) {
					issues.push({ type: 'self', taskId: fullId });
					continue;
				}
				const ref = sibling ? `${t.id}.${dep}` : dep;
				if (!exists(tasks, ref)) {
					issues.push({ type: 'missing', taskId: fullId, dependencyId: ref });
				}
			}
			if (inLoopBySearch(graph, fullId)) {
				issues.push({
					type: 'circular',
					taskId: fullId,
					fixable: inLoopBySearch(subtaskGraph, fullId)
				});
			}
		}
	}
	return issues;
}

function randomProject(seed: number): Raw[] {
	const next = random(seed);
	const size = 3 + Math.floor(next() * 12);
	const dependency = (): Id => {
		const kind = next();
		if (kind < 0.3) return Math.floor(next() * (size + 2)) + 1;
		if (kind < 0.45) return String(Math.floor(next() * (size + 2)) + 1);
		if (kind < 0.75) {
			return `${Math.floor(next() * size) + 1}.${Math.floor(next() * 4) + 1}`;
		}
		if (kind < 0.9) return Math.floor(next() * 5) + 1;
		return 100 + Math.floor(next() * 3);
	};
	const list = () => Array.from({ length: Math.floor(next() * 3) }, dependency);
	return Array.from({ length: size }, (_, i) => ({
		// Some projects use string IDs, as tm-core saves them
		id: seed % 2 === 0 ? String(i + 1) : i + 1,
		title: 't',
		status: 'pending',
		dependencies: list(),
		...(next() < 0.7 && {
			subtasks: Array.from({ length: Math.floor(next() * 4) }, (_, s) => ({
				id: s + 1,
				title: 's',
				status: 'pending',
				dependencies: list()
			}))
		})
	}));
}

/** The loop breaking as a search per dependency for a way back */
function breakSubtaskLoopsBySearch(tasks: Raw[]) {
	// Self edges count here: a subtask that names itself leads back at once
	const subtaskGraph = new Map<string, string[]>();
	for (const t of tasks) {
		for (const s of t.subtasks ?? []) {
			subtaskGraph.set(
				`${t.id}.${s.id}`,
				Array.isArray(s.dependencies)
					? s.dependencies.map((d: Id) => resolveSubtaskDependency(t.id, d))
					: []
			);
		}
	}
	const leadsBack = (from: string, target: string): boolean => {
		const seen = new Set<string>();
		const stack = [from];
		while (stack.length > 0) {
			const id = stack.pop() as string;
			if (id === target) return true;
			if (seen.has(id)) continue;
			seen.add(id);
			stack.push(...(subtaskGraph.get(id) ?? []));
		}
		return false;
	};

	const removed: Raw[] = [];
	for (const [subtaskId, dependencies] of subtaskGraph) {
		const [taskId, subtaskNum] = subtaskId.split('.');
		const s = tasks
			.find((t) => String(t.id) === taskId)
			?.subtasks?.find((st: Raw) => String(st.id) === subtaskNum);
		if (!s?.dependencies) continue;
		for (const depId of [...dependencies]) {
			if (!leadsBack(depId, subtaskId)) continue;
			const before = s.dependencies.length;
			s.dependencies = s.dependencies.filter(
				(d: Id) => resolveSubtaskDependency(taskId, d) !== depId
			);
			dependencies.splice(dependencies.indexOf(depId), 1);
			if (s.dependencies.length < before) {
				removed.push({ taskId: subtaskId, dependencyId: depId });
			}
		}
	}
	return removed;
}

describe('against a search per ID', () => {
	it('validate reports the same issues, including fixable, on random projects', () => {
		let loops = 0;
		let unfixable = 0;
		for (let seed = 1; seed <= 1500; seed++) {
			const tasks = randomProject(seed);

			const { issues } = validate(structuredClone(tasks));

			expect(
				issues.map(({ message: _message, ...issue }) => issue),
				`seed ${seed}`
			).toEqual(validateBySearch(tasks));
			loops += issues.filter((issue) => issue.type === 'circular').length;
			unfixable += issues.filter((issue) => issue.fixable === false).length;
		}
		// The generator has to reach loops of both kinds, or this proves little
		expect(loops).toBeGreaterThan(100);
		expect(unfixable).toBeGreaterThan(20);
	});

	it('breakSubtaskLoops drops the same dependencies, in the same order', () => {
		let dropped = 0;
		for (let seed = 1; seed <= 1500; seed++) {
			const tasks = randomProject(seed);
			const expected = structuredClone(tasks);

			const removed = breakSubtaskLoops(asTasks(tasks));

			expect(removed, `seed ${seed}`).toEqual(
				breakSubtaskLoopsBySearch(expected)
			);
			expect(tasks, `seed ${seed}`).toEqual(expected);
			dropped += removed.length;
		}
		expect(dropped).toBeGreaterThan(100);
	});
});

// ----- Large projects -----

const chain = (length: number, subtasksPerTask = 0): Raw[] =>
	Array.from({ length }, (_, i) => ({
		id: i + 1,
		title: `Task ${i + 1}`,
		status: 'pending',
		dependencies: i === 0 ? [] : [i],
		subtasks: Array.from({ length: subtasksPerTask }, (_, s) => ({
			id: s + 1,
			title: `Subtask ${s + 1}`,
			status: 'pending',
			dependencies: s === 0 ? [] : [s]
		}))
	}));

describe('large projects', () => {
	it('finds every task of a loop closed at the end of a long chain', () => {
		const tasks = chain(20000);
		tasks[0].dependencies = [20000];

		const { issues } = validate(tasks);

		expect(issues).toHaveLength(20000);
		expect(issues.every((issue) => issue.type === 'circular')).toBe(true);
	});

	it('checks a chain too deep for recursion', () => {
		expect(validate(chain(100000)).valid).toBe(true);
	});

	it('breaks every loop of a long ring of subtasks', () => {
		// Every other task's subtasks loop (1 -> 3 -> 2 -> 1), and each first
		// subtask waits on the last one of the task before: one ring through all
		const tasks = chain(10000, 3);
		for (let i = 0; i < tasks.length; i++) {
			const first = tasks[i].subtasks[0];
			if (i % 2 === 0) first.dependencies = [3];
			first.dependencies.push(`${i === 0 ? tasks.length : i}.3`);
		}

		const removed = breakSubtaskLoops(asTasks(tasks));

		// Each small loop loses one edge; the ring loses one more
		expect(removed).toHaveLength(5001);
		expect(validate(tasks).valid).toBe(true);
	});
});
