/**
 * The loop check finds loop members in one pass over the dependency graph
 * (strongly connected components), not one reachability search per task, which
 * made `set-status` slow on very large projects. fix-dependencies breaks
 * subtask loops the same way. Pure functions, no mocks.
 */

import {
	breakSubtaskLoops,
	buildDependencyGraph,
	createTaskLookup,
	findLoopMembers,
	validateTaskDependencies
} from '../../../../../scripts/modules/dependency-manager.js';
import { taskExists } from '../../../../../scripts/modules/utils.js';
import { resolveSubtaskDependency } from '@tm/core';

/** The earlier check: a search from each ID for a way back to it */
function isInLoopBySearch(graph, id) {
	const leadsBack = (from, seen) => {
		if (from === id) return true;
		if (seen.has(from)) return false;
		seen.add(from);
		return (graph.get(from) || []).some((next) => leadsBack(next, seen));
	};
	const seen = new Set();
	return (graph.get(id) || []).some((dep) => leadsBack(dep, seen));
}

/** The fastest of a few runs, so one pause on a busy machine doesn't count */
function fastest(run, makeInput, runs = 3) {
	let best = Number.POSITIVE_INFINITY;
	for (let r = 0; r < runs; r++) {
		const input = makeInput();
		const started = performance.now();
		run(input);
		best = Math.min(best, performance.now() - started);
	}
	return best;
}

// The timing tests compare two timings on the same machine, so the test
// timeout only has to stop a run that hangs, not bound the speed; on a busy
// runner the runs and the project builds between them outlast 5 s.
const TIMING_TEST_TIMEOUT = 30000;

/** Small deterministic generator, so a failure can be reproduced */
function random(seed) {
	let state = seed;
	return () => {
		state = (state * 1664525 + 1013904223) % 4294967296;
		return state / 4294967296;
	};
}

function randomGraph(seed, size, edgesPerNode) {
	const next = random(seed);
	const graph = new Map();
	for (let i = 0; i < size; i++) graph.set(`n${i}`, []);
	for (let i = 0; i < size; i++) {
		const edges = [];
		const count = Math.floor(next() * (edgesPerNode + 1));
		for (let e = 0; e < count; e++) {
			const target = Math.floor(next() * (size + 2));
			// A few targets are not in the graph, like a missing dependency
			const id = target < size ? `n${target}` : `missing${target}`;
			// Self edges stay in: a search from the ID finds its way back at once
			edges.push(id);
		}
		graph.set(`n${i}`, edges);
	}
	return graph;
}

describe('findLoopMembers', () => {
	it('finds exactly the IDs the per-ID search finds, on random graphs', () => {
		for (let seed = 1; seed <= 200; seed++) {
			const graph = randomGraph(seed, 5 + (seed % 25), 1 + (seed % 3));

			const expected = new Set(
				[...graph.keys()].filter((id) => isInLoopBySearch(graph, id))
			);

			expect(findLoopMembers(graph), `seed ${seed}`).toEqual(expected);
		}
	});

	it('leaves out tasks that only lead into a loop or are led to by one', () => {
		const graph = new Map([
			['a', ['b']],
			['b', ['c']],
			['c', ['b', 'd']],
			['d', []]
		]);

		expect(findLoopMembers(graph)).toEqual(new Set(['b', 'c']));
	});

	it('ignores edges to IDs that are not in the graph', () => {
		const graph = new Map([['a', ['ghost']]]);

		expect(findLoopMembers(graph)).toEqual(new Set());
	});
});

const chain = (length, subtasksPerTask = 0) =>
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

describe('validateTaskDependencies on a large project', () => {
	// Timed against copying the same project (structuredClone, one pass over
	// it), not a fixed number of seconds, so a slow or busy runner slows both
	// sides. One pass takes 3 to 5 copies. Looking each dependency up with a
	// scan of the task list takes 22 to 27 copies, so the bound sits between.
	// A loop search per task overflows the stack on this chain.
	it(
		'checks a long chain of tasks with subtasks in linear time',
		() => {
			expect(validateTaskDependencies(chain(20000, 3))).toEqual({
				valid: true,
				issues: []
			});

			const validateTime = fastest(validateTaskDependencies, () =>
				chain(20000, 3)
			);
			const copyTime = fastest(structuredClone, () => chain(20000, 3));

			expect(validateTime).toBeLessThan(copyTime * 10);
		},
		TIMING_TEST_TIMEOUT
	);

	it('finds every task of a loop closed at the end of a long chain', () => {
		const tasks = chain(20000);
		tasks[0].dependencies = [20000];

		const { issues } = validateTaskDependencies(tasks);

		expect(issues).toHaveLength(20000);
		expect(issues.every((issue) => issue.type === 'circular')).toBe(true);
	});

	it('checks a chain too deep for recursion', () => {
		const tasks = chain(100000);

		expect(validateTaskDependencies(tasks).valid).toBe(true);
	});
});

describe('createTaskLookup', () => {
	const tasks = [
		{ id: 1, subtasks: [{ id: 1 }, { id: 2 }] },
		{ id: 1, subtasks: [{ id: 9 }] }, // duplicate ID: the first one wins
		{ id: 2 },
		{ id: 3, subtasks: [] },
		{ id: '4', subtasks: [{ id: '1' }] }, // string IDs never match, as in taskExists
		{ id: NaN, subtasks: [{ id: NaN }] } // normalized from an ID that was not a number
	];
	const ids = [
		undefined,
		null,
		0,
		'0',
		'',
		1,
		'1',
		2,
		'2',
		3,
		4,
		'4',
		99,
		'1.1',
		'1.2',
		'1.9',
		'1.2.3',
		'1.2.x',
		'1.',
		'.1',
		'3.1',
		'2.1',
		'4.1',
		'3.y',
		'x.1',
		'x',
		'1x',
		NaN,
		'NaN',
		' 1',
		1.5,
		'1.5'
	];

	it('answers like taskExists for awkward IDs', () => {
		const exists = createTaskLookup(tasks);

		for (const id of ids) {
			expect(exists(id), `id ${JSON.stringify(id)}`).toBe(
				taskExists(tasks, id)
			);
		}
	});

	it('does not match a dotted ID that does not parse to numbers', () => {
		const exists = createTaskLookup([
			{ id: 3, subtasks: [{ id: 1 }, { id: NaN }] },
			{ id: NaN, subtasks: [{ id: 1 }] }
		]);

		expect(exists('3.y')).toBe(false);
		expect(exists('x.1')).toBe(false);
	});
});

/** The check before the one-pass version, as the reference for the new one */
function validateBySearch(tasks) {
	const issues = [];
	const graph = buildDependencyGraph(tasks);
	const subtaskGraph = buildDependencyGraph(tasks, { subtasksOnly: true });
	for (const task of tasks) {
		if (!task.dependencies) continue;
		for (const depId of task.dependencies) {
			if (String(depId) === String(task.id)) {
				issues.push({ type: 'self', taskId: task.id });
			} else if (!taskExists(tasks, depId)) {
				issues.push({ type: 'missing', taskId: task.id, dependencyId: depId });
			}
		}
		if (isInLoopBySearch(graph, String(task.id))) {
			issues.push({ type: 'circular', taskId: task.id, fixable: false });
		}
		for (const subtask of task.subtasks ?? []) {
			if (!subtask.dependencies) continue;
			const fullId = `${task.id}.${subtask.id}`;
			for (const depId of subtask.dependencies) {
				const sibling = typeof depId === 'number' && depId < 100;
				if (String(depId) === fullId || (sibling && depId === subtask.id)) {
					issues.push({ type: 'self', taskId: fullId });
					continue;
				}
				const ref = sibling ? `${task.id}.${depId}` : depId;
				if (!taskExists(tasks, ref)) {
					issues.push({ type: 'missing', taskId: fullId, dependencyId: ref });
				}
			}
			if (isInLoopBySearch(graph, fullId)) {
				issues.push({
					type: 'circular',
					taskId: fullId,
					fixable: isInLoopBySearch(subtaskGraph, fullId)
				});
			}
		}
	}
	return issues;
}

function randomProject(seed) {
	const next = random(seed);
	const size = 3 + Math.floor(next() * 12);
	const dependency = () => {
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
		id: i + 1,
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

describe('validateTaskDependencies', () => {
	it('reports what the per-ID search reported, including fixable, on random projects', () => {
		let loops = 0;
		let unfixable = 0;
		for (let seed = 1; seed <= 1500; seed++) {
			const tasks = randomProject(seed);

			const { issues } = validateTaskDependencies(structuredClone(tasks));
			const expected = validateBySearch(tasks);

			// Same issues in the same order, ignoring the message wording
			expect(
				issues.map(({ message: _message, ...issue }) => issue),
				`seed ${seed}`
			).toEqual(expected);
			loops += issues.filter((issue) => issue.type === 'circular').length;
			unfixable += issues.filter((issue) => issue.fixable === false).length;
		}
		// The generator has to reach loops of both kinds, or this proves little
		expect(loops).toBeGreaterThan(100);
		expect(unfixable).toBeGreaterThan(20);
	});
});

/**
 * The loop breaking before the one-pass version, as the reference for the new
 * one: a search per dependency for a way back to the subtask
 */
function breakSubtaskLoopsBySearch(tasks) {
	const subtaskDependencyMap = new Map();
	for (const task of tasks) {
		for (const subtask of task.subtasks ?? []) {
			subtaskDependencyMap.set(
				`${task.id}.${subtask.id}`,
				Array.isArray(subtask.dependencies)
					? subtask.dependencies.map((depId) =>
							typeof depId === 'string' && depId.includes('.')
								? depId
								: resolveSubtaskDependency(task.id, depId)
						)
					: []
			);
		}
	}
	const leadsBackTo = (from, target, seen = new Set()) => {
		if (from === target) return true;
		if (seen.has(from)) return false;
		seen.add(from);
		return (subtaskDependencyMap.get(from) || []).some((next) =>
			leadsBackTo(next, target, seen)
		);
	};

	const removed = [];
	for (const [subtaskId, dependencies] of subtaskDependencyMap.entries()) {
		const [taskId, subtaskNum] = subtaskId.split('.').map(Number);
		const subtask = tasks
			.find((t) => t.id === taskId)
			?.subtasks?.find((st) => st.id === subtaskNum);
		if (!subtask?.dependencies) continue;

		for (const depId of [...dependencies]) {
			if (!leadsBackTo(depId, subtaskId)) continue;
			const originalLength = subtask.dependencies.length;
			subtask.dependencies = subtask.dependencies.filter(
				(dep) => resolveSubtaskDependency(taskId, dep) !== depId
			);
			dependencies.splice(dependencies.indexOf(depId), 1);
			if (subtask.dependencies.length < originalLength) {
				removed.push({ taskId: subtaskId, dependencyId: depId });
			}
		}
	}
	return removed;
}

/** Subtasks that mostly depend on other subtasks, so loops are common */
function randomSubtaskProject(seed) {
	const next = random(seed);
	const size = 2 + Math.floor(next() * 8);
	const dependency = () => {
		const kind = next();
		if (kind < 0.45) return Math.floor(next() * 5) + 1;
		if (kind < 0.85) {
			return `${Math.floor(next() * size) + 1}.${Math.floor(next() * 5) + 1}`;
		}
		return String(Math.floor(next() * (size + 1)) + 1);
	};
	return Array.from({ length: size }, (_, i) => ({
		id: i + 1,
		dependencies: [],
		subtasks: Array.from({ length: Math.floor(next() * 6) }, (_, s) => ({
			id: s + 1,
			dependencies: Array.from(
				{ length: Math.floor(next() * 4) },
				dependency
			).filter((dep, at, all) => all.indexOf(dep) === at)
		}))
	}));
}

describe('breakSubtaskLoops', () => {
	it('drops the same dependencies, in the same order, as the per-dependency search', () => {
		let dropped = 0;
		for (let seed = 1; seed <= 1500; seed++) {
			const tasks =
				seed % 3 === 0 ? randomProject(seed) : randomSubtaskProject(seed);
			const expectedTasks = structuredClone(tasks);

			const removed = breakSubtaskLoops(tasks);
			const expected = breakSubtaskLoopsBySearch(expectedTasks);

			expect(removed, `seed ${seed}`).toEqual(expected);
			expect(tasks, `seed ${seed}`).toEqual(expectedTasks);
			dropped += removed.length;
		}
		// The generator has to make loops, or this proves little
		expect(dropped).toBeGreaterThan(1000);
	});

	it('matches the search when subtask IDs repeat or are not numbers', () => {
		const tasks = [
			{
				id: 1,
				subtasks: [
					{ id: 1, dependencies: [2] },
					{ id: 2, dependencies: [1] },
					{ id: 2, dependencies: [1, '2.1'] },
					{ id: '3', dependencies: [1] }
				]
			},
			{ id: 1, subtasks: [{ id: 1, dependencies: ['1.2'] }] },
			{ id: 2, subtasks: [{ id: 1, dependencies: ['1.1'] }] },
			{ id: '3', subtasks: [{ id: 1, dependencies: [1] }] }
		];
		const expectedTasks = structuredClone(tasks);

		expect(breakSubtaskLoops(tasks)).toEqual(
			breakSubtaskLoopsBySearch(expectedTasks)
		);
		expect(tasks).toEqual(expectedTasks);
	});

	it('leaves dependencies on tasks alone, even when they close a loop', () => {
		const tasks = [
			{ id: 1, dependencies: [], subtasks: [{ id: 1, dependencies: ['2'] }] },
			{ id: 2, dependencies: [], subtasks: [{ id: 1, dependencies: ['1.1'] }] }
		];

		expect(breakSubtaskLoops(tasks)).toEqual([]);
	});

	/**
	 * 10,000 tasks of 3 subtasks. Every other task's subtasks form a loop
	 * (1 -> 3 -> 2 -> 1), and each first subtask waits on the last one of the
	 * task before, which closes one ring through all 30,000 subtasks.
	 */
	const ringProject = () => {
		const tasks = chain(10000, 3);
		for (let i = 0; i < tasks.length; i++) {
			const first = tasks[i].subtasks[0];
			if (i % 2 === 0) first.dependencies = [3];
			first.dependencies.push(`${i === 0 ? tasks.length : i}.3`);
		}
		return tasks;
	};

	// The search per dependency overflowed the stack on this ring
	it('breaks every loop of a long ring of subtasks', () => {
		const tasks = ringProject();

		const removed = breakSubtaskLoops(tasks);

		// Each small loop loses one edge; the ring loses one more
		expect(removed).toHaveLength(5001);
		expect(validateTaskDependencies(tasks).valid).toBe(true);
	});

	// Timed against validate on the same project and machine, not against a
	// fixed number of seconds, so a slow or busy runner slows both sides. One
	// pass takes about as long as validate; a search per dependency on the
	// 30,000-subtask ring takes thousands of times longer.
	it(
		'takes about as long as validate on a large project',
		() => {
			const breakTime = fastest(breakSubtaskLoops, ringProject);
			const validateTime = fastest(validateTaskDependencies, ringProject);

			expect(breakTime).toBeLessThan(validateTime * 5);
		},
		TIMING_TEST_TIMEOUT
	);
});
