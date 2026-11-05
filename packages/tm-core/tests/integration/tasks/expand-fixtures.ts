/**
 * @fileoverview The tasks.json fixture and AI replies the tasks.expand
 * integration tests share.
 */

export const task = (id: string | number, title: string, extra = {}) => ({
	id,
	title,
	description: `${title} description about the command line flags and data`,
	status: 'pending',
	dependencies: [] as Array<string | number>,
	priority: 'medium',
	details: `${title} details: build the parser and authentication login`,
	testStrategy: 'unit tests',
	subtasks: [] as unknown[],
	metadata: undefined as unknown,
	...extra
});

export const sub = (id: number, title: string, extra = {}) => ({
	id,
	title,
	description: `${title} sub description`,
	status: 'pending',
	dependencies: [] as Array<string | number>,
	details: '',
	...extra
});

/** The tasks the legacy prompt inputs were captured from */
export function fixture(stringIds = false) {
	const id = (n: number) => (stringIds ? String(n) : n);
	const tasks = [
		task(id(1), 'Set up project scaffolding'),
		task(id(2), 'Implement CLI parser', {
			dependencies: [id(1)],
			subtasks: [
				sub(1, 'Parse flags'),
				sub(2, 'Parse commands', { dependencies: [1] })
			]
		}),
		task(id(3), 'Add user authentication', { dependencies: [id(1), id(2)] }),
		task(id(4), 'Database schema for users'),
		task(id(5), 'Deploy pipeline and release builds', {
			subtasks: [sub(1, 'Configure CI')]
		}),
		task(id(6), 'Display task list in the UI', { status: 'done' }),
		task(id(7), 'Research prompt models for AI integration'),
		task(id(8), 'Add task dependency handling')
	];
	return {
		master: { tasks, metadata: {} },
		feature: { tasks: tasks.slice(0, 4), metadata: {} }
	};
}

export const aiSubtask = (id: number, extra = {}) => ({
	id,
	title: `Step ${id}`,
	description: `Step ${id} description`,
	dependencies: [] as Array<string | number>,
	details: 'd',
	testStrategy: 't',
	...extra
});

export const answer = (subtasks = [aiSubtask(1), aiSubtask(2)]) => ({
	mainResult: { subtasks },
	telemetryData: { totalTokens: 10 },
	tagInfo: { currentTag: 'master', availableTags: ['master'] }
});
