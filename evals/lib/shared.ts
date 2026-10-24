/**
 * What evals/run.ts and the plan worker share.
 */

import type {
	EvalCall,
	JudgeVerdict,
	PlanComplexity,
	PlanTask
} from '@tm/core';

/** Where each sample's PRD goes in its project, and the path tasks cite it by */
export const PRD_PATH = '.taskgraph/docs/prd.md';

/** What the worker hands back for one sample */
export interface WorkerOutput {
	tasks: PlanTask[];
	complexity: PlanComplexity[];
	calls: EvalCall[];
	verdict: JudgeVerdict | null;
	error?: string;
}
