/**
 * @fileoverview The LLM judge for generated plans: a fixed rubric, the
 * prompt that asks a model to grade a plan against it, and the score read
 * back from its answer. Scored apart from the deterministic checks, since a
 * model's grade moves with the model.
 */

export interface JudgeCriterion {
	id: string;
	/** What the judge grades, as a question */
	question: string;
}

/** Each criterion is graded 1 (poor) to 5 (excellent) */
export const PLAN_JUDGE_RUBRIC: readonly JudgeCriterion[] = [
	{
		id: 'coverage',
		question:
			'Does the plan cover every requirement in the PRD, with nothing important missing?'
	},
	{
		id: 'fidelity',
		question:
			'Does the plan stay within the PRD: its stack, constraints and existing code, without invented scope?'
	},
	{
		id: 'sizing',
		question:
			'Is each task one coherent unit a developer could finish and verify, neither sprawling nor trivial?'
	},
	{
		id: 'ordering',
		question:
			'Do the dependencies follow the real build order, foundations before the work that needs them?'
	},
	{
		id: 'actionability',
		question:
			'Are details, test strategies and acceptance criteria concrete enough to start work without rereading the PRD?'
	},
	{
		id: 'subtasks',
		question:
			'Do the subtasks break each task into concrete, ordered steps that add up to the task?'
	}
];

export const JUDGE_MIN_GRADE = 1;
export const JUDGE_MAX_GRADE = 5;

/** The judge's answer, as the runner asks for it */
export interface JudgeVerdict {
	grades: Array<{ id: string; grade: number; reason: string }>;
	summary: string;
}

export interface JudgeScore {
	/** Mean grade mapped to 0..1 (1 → 0, 5 → 1) */
	score: number;
	/** Grade per rubric criterion */
	grades: Record<string, number>;
	summary: string;
}

/** The plan as the judge reads it: no IDs it can't see, no stored state */
interface JudgedTask {
	id: number | string;
	title?: string;
	description?: string;
	details?: string;
	testStrategy?: string;
	dependencies?: Array<number | string>;
	acceptanceCriteria?: unknown;
	subtasks?: Array<{
		id: number | string;
		title?: string;
		description?: string;
		dependencies?: Array<number | string>;
	}>;
}

function criteriaText(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	return raw
		.map((c) => (typeof c === 'string' ? c : (c as { text?: string })?.text))
		.filter((c): c is string => typeof c === 'string' && c.trim() !== '');
}

/** The plan in the compact shape the judge prompt carries */
export function planForJudge(tasks: JudgedTask[]): unknown[] {
	return tasks.map((task) => ({
		id: task.id,
		title: task.title,
		description: task.description,
		details: task.details,
		testStrategy: task.testStrategy,
		dependencies: task.dependencies ?? [],
		acceptanceCriteria: criteriaText(task.acceptanceCriteria),
		subtasks: (task.subtasks ?? []).map((sub) => ({
			id: `${task.id}.${sub.id}`,
			title: sub.title,
			description: sub.description,
			dependencies: sub.dependencies ?? []
		}))
	}));
}

export function buildJudgePrompt(
	prd: string,
	tasks: JudgedTask[]
): { systemPrompt: string; prompt: string } {
	const rubric = PLAN_JUDGE_RUBRIC.map((c) => `- ${c.id}: ${c.question}`).join(
		'\n'
	);
	return {
		systemPrompt: [
			'You grade software project plans generated from a PRD.',
			`Grade each rubric criterion from ${JUDGE_MIN_GRADE} (poor) to ${JUDGE_MAX_GRADE} (excellent), with a one-sentence reason.`,
			'Judge only what the plan says. Be strict: a 5 means a senior engineer would change nothing.',
			'Do not read or change any files.'
		].join('\n'),
		prompt: [
			'Rubric:',
			rubric,
			'',
			'PRD:',
			'<prd>',
			prd,
			'</prd>',
			'',
			'Plan (tasks with their subtasks; a subtask dependency that is a bare number names a sibling):',
			'<plan>',
			JSON.stringify(planForJudge(tasks), null, 1),
			'</plan>',
			'',
			'Return one grade per rubric id, and a two-sentence summary of the plan.'
		].join('\n')
	};
}

/**
 * The score of a judge's answer. Grades are clamped to the rubric's range;
 * a criterion the judge left out, graded twice, or not on the rubric makes
 * the verdict unusable (null), since a partial grade can't be compared with
 * a baseline.
 */
export function scoreJudgeVerdict(verdict: JudgeVerdict): JudgeScore | null {
	const grades: Record<string, number> = {};
	const known = new Set(PLAN_JUDGE_RUBRIC.map((c) => c.id));
	for (const { id, grade } of verdict.grades ?? []) {
		if (!known.has(id) || id in grades || !Number.isFinite(grade)) return null;
		grades[id] = Math.min(
			JUDGE_MAX_GRADE,
			Math.max(JUDGE_MIN_GRADE, Math.round(grade))
		);
	}
	if (Object.keys(grades).length !== known.size) return null;
	const mean =
		Object.values(grades).reduce((sum, g) => sum + g, 0) / known.size;
	return {
		score: (mean - JUDGE_MIN_GRADE) / (JUDGE_MAX_GRADE - JUDGE_MIN_GRADE),
		grades,
		summary: verdict.summary ?? ''
	};
}
