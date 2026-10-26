/**
 * @fileoverview Scoring for `npm run evals:review`: the review bot's findings
 * on a PR against the bugs that PR is known to hold (from a later revert or
 * fix-forward), so recall and noise can be compared run to run.
 */

/** A bug a merged PR shipped, confirmed by the PR that fixed it */
export interface KnownBug {
	/** Path from the repository root */
	file: string;
	/** Lines in the PR's version of the file; a finding near any of them counts */
	lines: number[];
	/** The PR that reverted or fixed it */
	fixedBy: number;
	bug: string;
}

/** One `FINDING <path>:<line> <text>` line from the reviewer's reply */
export interface ReviewFinding {
	file: string;
	line: number;
	text: string;
}

export interface ReviewCaseResult {
	id: string;
	pr: number;
	/** Known bugs; 0 for a clean PR */
	bugs: number;
	/** The `bug` text of each known bug a finding landed on */
	caught: string[];
	findings: ReviewFinding[];
	/** Findings near no known bug: every finding on a clean PR is one */
	unmatched: number;
	seconds: number;
	costUsd: number;
	error?: string;
}

export interface ReviewRunSummary {
	/** Caught over known bugs, across the cases that ran */
	recall: number | null;
	caught: number;
	bugs: number;
	/** Findings on known-clean PRs */
	cleanFindings: number;
	/** Findings on buggy PRs that hit no known bug (may be real, unconfirmed) */
	otherFindings: number;
	failed: number;
	seconds: number;
	costUsd: number;
}

/** A finding this many lines from a known bug's line still counts */
export const REVIEW_LINE_SLACK = 5;

const FINDING_LINE = /^\s*[-*]?\s*`?FINDING\s+`?([^\s:`]+):(\d+)`?\s*(.*)$/gm;

const normalizePath = (file: string) => file.replace(/^(\.\/|[ab]\/)/, '');

/** The `FINDING path:line text` lines in a reply, in order */
export function parseReviewFindings(reply: string): ReviewFinding[] {
	return [...reply.matchAll(FINDING_LINE)].map((m) => ({
		file: normalizePath(m[1]),
		line: Number(m[2]),
		text: m[3].replace(/`$/, '').trim()
	}));
}

const hits = (finding: ReviewFinding, bug: KnownBug) =>
	normalizePath(bug.file) === finding.file &&
	bug.lines.some((l) => Math.abs(l - finding.line) <= REVIEW_LINE_SLACK);

/** Which known bugs the findings caught, and how many findings hit none */
export function scoreReviewFindings(
	bugs: KnownBug[],
	findings: ReviewFinding[]
): { caught: string[]; unmatched: number } {
	return {
		caught: bugs
			.filter((b) => findings.some((f) => hits(f, b)))
			.map((b) => b.bug),
		unmatched: findings.filter((f) => !bugs.some((b) => hits(f, b))).length
	};
}

export function summarizeReviewRun(
	cases: ReviewCaseResult[]
): ReviewRunSummary {
	const ran = cases.filter((c) => c.error === undefined);
	const bugs = ran.reduce((sum, c) => sum + c.bugs, 0);
	const caught = ran.reduce((sum, c) => sum + c.caught.length, 0);
	const sumUnmatched = (clean: boolean) =>
		ran
			.filter((c) => (c.bugs === 0) === clean)
			.reduce((sum, c) => sum + c.unmatched, 0);
	return {
		recall: bugs === 0 ? null : caught / bugs,
		caught,
		bugs,
		cleanFindings: sumUnmatched(true),
		otherFindings: sumUnmatched(false),
		failed: cases.length - ran.length,
		seconds: cases.reduce((sum, c) => sum + c.seconds, 0),
		costUsd: cases.reduce((sum, c) => sum + c.costUsd, 0)
	};
}
