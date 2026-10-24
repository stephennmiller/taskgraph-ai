/**
 * @fileoverview The tasks, scenarios and AI answers the legacy
 * analyze-complexity prompt inputs were captured from
 * (__snapshots__/analyze-complexity-prompt-inputs.legacy.json)
 */

const task = (id: string | number, title: string, extra = {}) => ({
	id,
	title,
	description: `${title} description about the command line flags and data`,
	status: 'pending',
	dependencies: [] as Array<string | number>,
	priority: 'medium',
	details: `${title} details: build the parser and authentication login`,
	testStrategy: 'unit tests',
	subtasks: [] as unknown[],
	...extra
});

const sub = (id: number | string, title: string, extra = {}) => ({
	id,
	title,
	description: `${title} sub description`,
	status: 'pending',
	dependencies: [] as Array<string | number>,
	details: '',
	...extra
});

export function fixture(stringIds = false) {
	const id = (n: number) => (stringIds ? String(n) : n);
	const tasks = [
		task(id(1), 'Set up project scaffolding', { status: 'done' }),
		task(id(2), 'Implement CLI parser', {
			dependencies: [id(1)],
			subtasks: [
				sub(id(1), 'Parse flags'),
				sub(stringIds ? '2.2' : 2, 'Parse commands', { dependencies: [1] })
			]
		}),
		task(id(3), 'Add user authentication', {
			dependencies: [id(1), id(2)],
			status: 'in-progress'
		}),
		task(id(4), 'Database schema for users', { status: 'blocked' }),
		task(id(5), 'Deploy pipeline and release builds', {
			subtasks: [sub(1, 'Configure CI')]
		}),
		task(id(6), 'Display task list in the UI', { status: 'completed' }),
		task(id(7), 'Research prompt models for AI integration', {
			status: 'deferred'
		}),
		task(id(8), 'Add task dependency handling')
	];
	return {
		master: { tasks, metadata: {} },
		feature: { tasks: tasks.slice(1, 4), metadata: {} }
	};
}

const entry = (taskId: number, score: number) => ({
	taskId,
	taskTitle: `Task ${taskId}`,
	complexityScore: score,
	recommendedSubtasks: 3,
	expansionPrompt: `prompt ${taskId}`,
	reasoning: `reason ${taskId}`
});

export interface Scenario {
	name: string;
	ids?: string;
	from?: number | string;
	to?: number | string;
	threshold?: number | string;
	research?: boolean;
	tag?: string;
	stringIds?: boolean;
	report?: unknown;
	/** Task IDs the AI leaves out of its answer */
	omit?: number[];
	config?: unknown;
}

export const scenarios: Scenario[] = [
	{ name: 'default' },
	{ name: 'research, threshold 7', research: true, threshold: '7' },
	{ name: 'ids with a done and a missing one', ids: '2,3,6,42' },
	{ name: 'range', from: 3, to: 5 },
	{ name: 'from only', from: '4' },
	{ name: 'to only', to: 3 },
	{ name: 'string ids', stringIds: true, ids: '2,8' },
	{ name: 'feature tag', tag: 'feature' },
	{
		name: 'merge into an existing report',
		ids: '2',
		report: {
			meta: {},
			complexityAnalysis: [entry(2, 1), entry(3, 8), entry(99, 4)]
		}
	},
	{
		name: 'no match keeps the existing report',
		ids: '1,6',
		report: { meta: {}, complexityAnalysis: [entry(3, 8)] }
	},
	{ name: 'no match without a report', from: 6, to: 7 },
	{ name: 'AI leaves a task out', omit: [8] },
	{
		name: 'codebase analysis off',
		config: { models: {}, global: { enableCodebaseAnalysis: false } }
	},
	{
		name: 'project name',
		config: { models: {}, global: { projectName: 'Acme' } }
	}
];

const ACTIVE = new Set([2, 3, 4, 5, 8]);
const FEATURE_ACTIVE = new Set([2, 3, 4]);

/** The AI's answer: one entry per task it was asked about, minus `omit` */
export function answerFor(s: Scenario) {
	const active = s.tag === 'feature' ? FEATURE_ACTIVE : ACTIVE;
	const asked = (s.ids ? s.ids.split(',').map(Number) : [...active]).filter(
		(id) =>
			active.has(id) &&
			id >= Number(s.from ?? 1) &&
			id <= Number(s.to ?? 99) &&
			!(s.omit ?? []).includes(id)
	);
	return {
		mainResult: {
			complexityAnalysis: asked.map((id) => entry(id, id))
		},
		telemetryData: { totalTokens: 1 },
		tagInfo: { currentTag: s.tag ?? 'master', availableTags: [] }
	};
}
