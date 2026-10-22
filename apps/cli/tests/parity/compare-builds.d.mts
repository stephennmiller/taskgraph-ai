export interface SnapshotDiff {
	file: string;
	kind: 'changed' | 'only-in-a' | 'only-in-b';
	diff: string;
}

export function diffSnapshots(
	a: Record<string, string>,
	b: Record<string, string>
): SnapshotDiff[];

export interface RunSummary {
	steps: number;
	failed: number;
	changedFiles: number;
}

export function summarizeRun(run: {
	steps: Array<{
		args: string[];
		status: number | null;
		files: Record<string, string>;
	}>;
}): RunSummary;

export function buildEnv(
	workDir: string,
	base?: Record<string, string | undefined>
): Record<string, string | undefined>;

export interface Difference {
	step: number;
	args: string[];
	kind: string;
	detail: string;
}

export function compareRuns(a: any, b: any): Difference[];

export function formatReport(
	differences: Difference[],
	stepCount: number,
	labels: { a: string; b: string }
): string;

export interface ScenarioStep {
	args: string[];
	status: number | null;
	error?: string;
	stderr?: string;
	files: Record<string, string>;
}

export function runScenario(
	build: string,
	scenario: {
		fixture?: string;
		replies?: object[];
		steps: unknown[];
	}
): { steps: ScenarioStep[] };
