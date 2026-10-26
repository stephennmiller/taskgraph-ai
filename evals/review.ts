/**
 * `npm run evals:review`: run the review bot's prompt, from
 * .github/workflows/claude-code-review.yml, on merged PRs that shipped a bug
 * later reverted or fixed forward, and on a few known-clean PRs. It scores
 * recall (known bugs a finding landed on) and noise (findings on clean PRs).
 *
 *   npm run evals:review                         every case
 *   npm run evals:review -- --only 683-placeholder-tasks-json
 *   npm run evals:review -- --update-baseline    save as evals/review-baseline.json
 *
 * Re-run it when the review workflow's prompt, tools or model change, and add
 * each new revert or fix-forward to evals/review-cases.json. Each case runs
 * `claude -p` with the workflow's prompt in a detached worktree at the PR's
 * merge commit, holding today's REVIEW.md, CLAUDE.md and .claude/rules. An
 * appended system prompt stops it posting to GitHub and asks for its findings
 * as `FINDING <path>:<line>` lines. It calls the model for real and is never
 * run in CI. Needs `claude` signed in, `gh` signed in, and the full git
 * history (`git fetch --unshallow` in a shallow clone).
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
	type KnownBug,
	type ReviewCaseResult,
	type ReviewRunSummary,
	parseReviewFindings,
	scoreReviewFindings,
	summarizeReviewRun
} from '@tm/core';
import { load } from 'js-yaml';
import { biomeFormattedJson } from './lib/baseline.js';
import { fail } from './lib/shared.js';

interface ReviewCase {
	id: string;
	pr: number;
	commit: string;
	bugs: KnownBug[];
}

interface ReviewRun {
	date: string;
	commit?: string;
	cases: ReviewCaseResult[];
	summary: ReviewRunSummary;
}

const evalsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(evalsDir);
const resultsDir = path.join(evalsDir, 'results');
const baselinePath = path.join(evalsDir, 'review-baseline.json');
const workflowPath = path.join(
	repoRoot,
	'.github',
	'workflows',
	'claude-code-review.yml'
);
// Copied into each case's worktree, so an old PR is reviewed by today's rules
const REVIEW_RULES = ['REVIEW.md', 'CLAUDE.md', '.claude/rules'];
// Writes to GitHub; denied even when the workflow or user settings allow them
const NO_POSTING = [
	'Bash(gh pr comment:*)',
	'Bash(gh pr review:*)',
	'Bash(gh issue comment:*)',
	'Bash(gh api:*)',
	'mcp__github_inline_comment__create_inline_comment'
];
const REVIEW_TOOLS = ['Read', 'Grep', 'Glob', 'Bash'];
const EVAL_INSTRUCTIONS = `This is an offline evaluation of the review prompt, not a live review. Treat the pull request as having no earlier review rounds. Post nothing to GitHub. In place of the inline comments, end your reply with one line per finding, exactly:
FINDING <path from the repository root>:<line in the PR's version of the file> <bug class>: <one sentence>
With no findings, end your reply with: NO FINDINGS`;

const { values: args } = parseArgs({
	options: {
		only: { type: 'string' },
		'update-baseline': { type: 'boolean', default: false }
	}
});

function run(cmd: string, cmdArgs: string[], cwd = repoRoot): string {
	const result = spawnSync(cmd, cmdArgs, { cwd, encoding: 'utf8' });
	if (result.status !== 0) {
		throw new Error(
			`${cmd} ${cmdArgs[0]} failed: ${(result.stderr || result.error?.message || '').trim()}`
		);
	}
	return result.stdout;
}

const allCases: ReviewCase[] = JSON.parse(
	fs.readFileSync(path.join(evalsDir, 'review-cases.json'), 'utf8')
);
const only = args.only?.split(',').map((id) => id.trim());
const unknown = only?.filter((id) => !allCases.some((c) => c.id === id));
if (unknown?.length) {
	fail(
		`No case named ${unknown.join(', ')}`,
		`Cases: ${allCases.map((c) => c.id).join(', ')}`
	);
}
if (only && args['update-baseline']) {
	fail(
		"--update-baseline needs every case, so it can't be used with --only",
		'Run `npm run evals:review -- --update-baseline`'
	);
}
const cases = only ? allCases.filter((c) => only.includes(c.id)) : allCases;

/** The claude-code-action step's inputs in the review workflow */
function reviewStep(): { prompt: string; claudeArgs: string } {
	const workflow = load(fs.readFileSync(workflowPath, 'utf8')) as {
		jobs: Record<
			string,
			{ steps?: { uses?: string; with?: Record<string, unknown> }[] }
		>;
	};
	const step = Object.values(workflow.jobs)
		.flatMap((job) => job.steps ?? [])
		.find((s) => s.uses?.startsWith('anthropics/claude-code-action'));
	const prompt: unknown = step?.with?.prompt;
	if (typeof prompt !== 'string') {
		fail(
			`No claude-code-action prompt in ${path.relative(repoRoot, workflowPath)}`,
			"The eval runs that step's prompt"
		);
	}
	if (prompt.trimStart().startsWith('/')) {
		fail(
			'The review workflow runs a plugin command, which skips any PR the bot already commented on',
			'This eval needs the inline review prompt (#759)'
		);
	}
	return { prompt, claudeArgs: String(step?.with?.claude_args ?? '') };
}

/** Fill in `${{ github.repository }}` and `${{ github.event.pull_request.* }}` */
function interpolate(
	text: string,
	repo: string,
	pull: Record<string, unknown>
): string {
	return text.replace(/\$\{\{\s*([\w.]+)\s*\}\}/g, (_, expr: string) => {
		if (expr === 'github.repository') return repo;
		const prefix = 'github.event.pull_request.';
		const value = expr.startsWith(prefix)
			? expr
					.slice(prefix.length)
					.split('.')
					.reduce<unknown>(
						(obj, key) => (obj as Record<string, unknown> | undefined)?.[key],
						pull
					)
			: undefined;
		if (typeof value !== 'string' && typeof value !== 'number') {
			throw new Error(`can't fill in \${{ ${expr} }} outside GitHub Actions`);
		}
		return String(value);
	});
}

/** The workflow's --allowedTools, less anything that posts */
function allowedTools(claudeArgs: string): string[] {
	const list = /--allowedTools\s+"([^"]*)"/.exec(claudeArgs)?.[1] ?? '';
	return list
		.split(',')
		.map((t) => t.trim())
		.filter((t) => t && !/comment|gh api/i.test(t));
}

const withTools = (flag: string, tools: string[]) =>
	tools.length ? [flag, ...tools] : [];

function evaluate(
	c: ReviewCase,
	step: { prompt: string; claudeArgs: string }
): ReviewCaseResult {
	const base = { id: c.id, pr: c.pr, bugs: c.bugs.length };
	const started = Date.now();
	const dir = fs.mkdtempSync(
		path.join(os.tmpdir(), `taskgraph-review-${c.id}-`)
	);
	try {
		run('git', ['worktree', 'add', '--detach', '--quiet', dir, c.commit]);
		for (const rule of REVIEW_RULES) {
			const from = path.join(repoRoot, rule);
			if (fs.existsSync(from)) {
				fs.cpSync(from, path.join(dir, rule), { recursive: true });
			}
		}
		// gh fills {owner}/{repo} from this clone's remote
		const pull = JSON.parse(
			run('gh', ['api', `repos/{owner}/{repo}/pulls/${c.pr}`])
		);
		const repo: string = pull.base.repo.full_name;
		const result = spawnSync(
			'claude',
			[
				'-p',
				interpolate(step.prompt, repo, pull),
				'--output-format',
				'json',
				'--append-system-prompt',
				EVAL_INSTRUCTIONS,
				// No user/project settings or MCP servers: their allow rules (merge, push) must not reach an old PR's prompt
				'--restricted',
				'--strict-mcp-config',
				'--tools',
				...REVIEW_TOOLS,
				...withTools(
					'--allowedTools',
					allowedTools(interpolate(step.claudeArgs, repo, pull))
				),
				'--disallowedTools',
				...NO_POSTING
			],
			// The workflow job's limit is 10 minutes
			{ cwd: dir, encoding: 'utf8', timeout: 15 * 60_000 }
		);
		const reply = JSON.parse(result.stdout || '{}') as {
			result?: string;
			is_error?: boolean;
			total_cost_usd?: number;
		};
		if (result.status !== 0 || reply.is_error || reply.result === undefined) {
			throw new Error(
				`claude exited ${result.status ?? result.signal}: ${(reply.result ?? result.stderr).trim().slice(0, 300)}`
			);
		}
		const findings = parseReviewFindings(reply.result);
		return {
			...base,
			...scoreReviewFindings(c.bugs, findings),
			findings,
			seconds: (Date.now() - started) / 1000,
			costUsd: reply.total_cost_usd ?? 0
		};
	} catch (error) {
		return {
			...base,
			caught: [],
			findings: [],
			unmatched: 0,
			seconds: (Date.now() - started) / 1000,
			costUsd: 0,
			error: error instanceof Error ? error.message : String(error)
		};
	} finally {
		spawnSync('git', ['worktree', 'remove', '--force', dir], { cwd: repoRoot });
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

const missing = cases.filter(
	(c) =>
		spawnSync('git', ['cat-file', '-e', `${c.commit}^{commit}`], {
			cwd: repoRoot
		}).status !== 0
);
if (missing.length) {
	fail(
		`Commits not in this clone: ${missing.map((c) => c.id).join(', ')}`,
		'Run `git fetch --unshallow origin` (or `git fetch origin`) and retry'
	);
}
const step = reviewStep();

const started = new Date();
const results: ReviewCaseResult[] = [];
console.error(
	`Reviewing ${cases.length} PRs; each takes a few minutes of model calls`
);
for (const [index, c] of cases.entries()) {
	console.error(`${c.id} (${index + 1} of ${cases.length})`);
	const result = evaluate(c, step);
	console.error(
		result.error
			? `✗ ${c.id}: ${result.error}`
			: `✓ ${c.id} · caught ${result.caught.length}/${result.bugs} · ${result.unmatched} other findings`
	);
	results.push(result);
}

const commit = run('git', ['rev-parse', '--short', 'HEAD']).trim();
const reviewRun: ReviewRun = {
	date: started.toISOString(),
	...(commit ? { commit } : {}),
	cases: results,
	summary: summarizeReviewRun(results)
};

const pct = (n: number | null) =>
	n === null ? '-' : `${Math.round(n * 100)}%`;
const line = (label: string, s: ReviewRunSummary) =>
	`${label.padEnd(10)} recall ${pct(s.recall)} (${s.caught}/${s.bugs})  clean-PR findings ${s.cleanFindings}  other findings ${s.otherFindings}  failed ${s.failed}  $${s.costUsd.toFixed(2)}`;

fs.mkdirSync(resultsDir, { recursive: true });
const resultFile = path.join(
	resultsDir,
	`review-${reviewRun.date.slice(0, 19).replaceAll(':', '-')}.json`
);
fs.writeFileSync(resultFile, `${JSON.stringify(reviewRun, null, '\t')}\n`);

console.log(`\nReview evals · ${results.length} PRs`);
console.log(line('this run', reviewRun.summary));
const baseline: ReviewRun | null = fs.existsSync(baselinePath)
	? JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
	: null;
if (baseline) {
	console.log(line('baseline', baseline.summary));
	console.log(
		`(baseline ${baseline.date.slice(0, 10)}, ${baseline.commit ?? ''})`
	);
} else if (!args['update-baseline']) {
	console.log(
		'No baseline yet; save one with npm run evals:review -- --update-baseline'
	);
}
console.log(`Saved to ${path.relative(repoRoot, resultFile)}`);

if (args['update-baseline']) {
	if (reviewRun.summary.failed > 0) {
		fail(
			`Baseline not updated: ${reviewRun.summary.failed} cases failed`,
			'Fix the failures and run again'
		);
	}
	fs.writeFileSync(
		baselinePath,
		biomeFormattedJson(reviewRun, repoRoot, baselinePath)
	);
	console.log(
		`Saved as the baseline in ${path.relative(repoRoot, baselinePath)}`
	);
}
if (reviewRun.summary.failed > 0) process.exitCode = 1;
