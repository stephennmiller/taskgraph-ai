#!/usr/bin/env node
// Agent workflow steps that every issue-batch thread repeats: worktree setup,
// merge readiness, rebasing after a merge, attribution checks. Run through
// bin/agent-cli. Needs git and an authenticated gh; no npm dependencies.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const HELP = {
	main: `Usage: agent-cli <command> [args] [--json]

Commands:
  wt <branch>        new worktree off origin/main, with npm ci
  wt-prune           delete node_modules in worktrees whose PR is closed
  ready <pr>...      can this PR merge under the project rules?
  conflicts          open PRs that need a rebase
  rebase             rebase this worktree onto origin/main and push
  attribution <pr>   find attribution in a PR body, comments, commits

Run agent-cli <command> --help for details.`,
	wt: `Usage: agent-cli wt <branch> [--no-install] [--json]

Creates <repo>/../wt/<branch> (AGENT_WT_ROOT overrides the parent).
New branches start at origin/main; a branch on origin is checked out.`,
	'wt-prune': `Usage: agent-cli wt-prune [--json]

Deletes node_modules in worktrees whose PR is merged or closed, to keep
the disk from filling. Leaves the worktrees themselves.`,
	ready: `Usage: agent-cli ready <pr>... [--json]

Ready means: no merge conflict, every check passed, the review bot's
latest comment says "No issues", no CODEOWNERS path touched, and no
attribution in the PR body. Exits 1 if any PR is not ready.`,
	conflicts: `Usage: agent-cli conflicts [--json]

Lists open PRs that conflict with main or are behind it.`,
	rebase: `Usage: agent-cli rebase [--json]

In the current worktree: fetch origin main, rebase onto it and push
with --force-with-lease. On a conflict it stops and lists the files.`,
	attribution: `Usage: agent-cli attribution <pr> [--clean] [--json]

Lists attribution lines in the PR body, its comments and its commits.
Exits 1 if any are found. --clean prints the body without them, to
pass to the GitHub MCP update_pull_request tool (gh api re-adds a
footer when it writes).`
};

const ATTRIBUTION = [
	/claude-projects-attribution/i,
	/^_?Requested by \*\*/i,
	/Generated (with|by) \[?Claude Code/i,
	/^Co-Authored-By:.*Claude/i,
	/^Claude-Session:/i,
	/claude\.ai\/code\/session_/i
];

/** Lines in text that carry attribution. */
export function findAttribution(text) {
	return (text ?? '')
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => ATTRIBUTION.some((re) => re.test(line)));
}

/** Text without attribution lines, a `---` left dangling before them, or trailing blanks. */
export function stripAttribution(text) {
	const lines = (text ?? '').split('\n');
	const kept = [];
	for (const line of lines) {
		if (ATTRIBUTION.some((re) => re.test(line.trim()))) {
			while (kept.length && /^\s*(---)?\s*$/.test(kept.at(-1))) kept.pop();
			continue;
		}
		kept.push(line);
	}
	while (kept.length && kept[0].trim() === '') kept.shift();
	while (kept.length && kept.at(-1).trim() === '') kept.pop();
	return kept.join('\n');
}

/** Turns a CODEOWNERS file into a function: path -> owned? */
export function codeownersMatcher(text) {
	const regexes = text
		.split('\n')
		.map((line) => line.replace(/#.*/, '').trim().split(/\s+/)[0])
		.filter(Boolean)
		.map((pattern) => {
			const anchored =
				pattern.startsWith('/') || pattern.slice(0, -1).includes('/');
			const body = pattern
				.replace(/^\//, '')
				.replace(/[.+^${}()|[\]\\]/g, '\\$&')
				.replace(/\*\*/g, '\0')
				.replace(/\*/g, '[^/]*')
				.replace(/\0/g, '.*')
				.replace(/\?/g, '[^/]');
			const tail = pattern.endsWith('/') ? '.*' : '(/.*)?';
			return new RegExp(`${anchored ? '^' : '(^|/)'}${body}${tail}$`);
		});
	return (file) => regexes.some((re) => re.test(file));
}

const PASSING = new Set(['success', 'skipped', 'neutral']);

/** Readiness verdict from data the GitHub API returns. */
export function evaluateReadiness({ pr, checks, botComments, files, isOwned }) {
	const reasons = [];
	if (pr.state !== 'open')
		reasons.push(`PR is ${pr.merged ? 'merged' : pr.state}`);
	if (pr.draft) reasons.push('draft');
	if (pr.mergeable === false)
		reasons.push('merge conflict, run agent-cli rebase');
	else if (pr.mergeable == null)
		reasons.push('GitHub is still computing mergeability, retry');
	if (pr.mergeable_state === 'behind') reasons.push('behind main');

	if (checks.length === 0) reasons.push('no checks have run');
	const pending = checks
		.filter((c) => c.status !== 'completed')
		.map((c) => c.name);
	const failed = checks
		.filter((c) => c.status === 'completed' && !PASSING.has(c.conclusion))
		.map((c) => c.name);
	if (pending.length) reasons.push(`checks running: ${pending.join(', ')}`);
	if (failed.length) reasons.push(`checks failed: ${failed.join(', ')}`);

	const review = botComments.at(-1)?.body.split('\n')[0] ?? null;
	if (!review) reasons.push('no review bot comment yet');
	else if (!/^No issues/i.test(review)) reasons.push(`review: ${review}`);

	const owned = files.filter(isOwned);
	if (owned.length)
		reasons.push(`CODEOWNERS paths, Steve merges: ${owned.join(', ')}`);

	const attribution = findAttribution(pr.body);
	if (attribution.length)
		reasons.push('attribution in PR body, run agent-cli attribution');

	return {
		number: pr.number,
		title: pr.title,
		ready: reasons.length === 0,
		review,
		reasons
	};
}

function run(cmd, args, opts = {}) {
	return execFileSync(cmd, args, {
		encoding: 'utf8',
		cwd: ROOT,
		...opts
	}).trim();
}

function repoSlug() {
	const url = run('git', ['remote', 'get-url', 'origin']);
	const match = url.match(/[/:]([^/:]+\/[^/]+?)(\.git)?$/);
	if (!match) throw new Error(`cannot read owner/repo from origin: ${url}`);
	return match[1];
}

function ghPages(endpoint) {
	return JSON.parse(
		run('gh', ['api', '--paginate', '--slurp', endpoint], {
			maxBuffer: 64 << 20
		})
	);
}

/** One object, or every item of a list endpoint across pages. */
function gh(endpoint) {
	const pages = ghPages(endpoint);
	return Array.isArray(pages[0]) ? pages.flat() : pages[0];
}

function checksFor(repo, sha) {
	return ghPages(
		`repos/${repo}/commits/${sha}/check-runs?per_page=100`
	).flatMap((p) => p.check_runs);
}

function prNumber(arg) {
	const n = Number(String(arg ?? '').replace(/^#/, ''));
	if (!Number.isInteger(n) || n <= 0)
		throw new Error(`not a PR number: ${arg}`);
	return n;
}

const commands = {
	wt([branch], flags) {
		if (!branch) throw new Error('missing <branch>');
		const parent = process.env.AGENT_WT_ROOT ?? path.join(ROOT, '..', 'wt');
		const dir = path.join(parent, branch.replaceAll('/', '-'));
		if (existsSync(dir)) throw new Error(`${dir} exists`);
		run('git', ['fetch', '-q', 'origin', 'main']);
		const onOrigin =
			run('git', ['ls-remote', '--heads', 'origin', branch]) !== '';
		if (onOrigin) {
			run('git', ['fetch', '-q', 'origin', branch]);
			run('git', [
				'worktree',
				'add',
				'-q',
				'--track',
				'-b',
				branch,
				dir,
				`origin/${branch}`
			]);
		} else {
			run('git', [
				'worktree',
				'add',
				'-q',
				'--no-track',
				'-b',
				branch,
				dir,
				'origin/main'
			]);
		}
		if (!flags.has('--no-install')) {
			const res = spawnSync(
				'npm',
				['ci', '--no-audit', '--no-fund', '--loglevel=error'],
				{
					cwd: dir,
					stdio: flags.has('--json') ? 'ignore' : 'inherit'
				}
			);
			if (res.status !== 0) throw new Error(`npm ci failed in ${dir}`);
		}
		return {
			result: {
				path: dir,
				branch,
				from: onOrigin ? `origin/${branch}` : 'origin/main'
			},
			text: dir
		};
	},

	'wt-prune'() {
		const repo = repoSlug();
		const owner = repo.split('/')[0];
		const trees = run('git', ['worktree', 'list', '--porcelain'])
			.split('\n\n')
			.map((block) => ({
				path: block.match(/^worktree (.+)$/m)?.[1],
				branch: block.match(/^branch refs\/heads\/(.+)$/m)?.[1]
			}))
			.filter((t) => t.branch && t.path !== ROOT);
		const pruned = [];
		for (const t of trees) {
			const modules = path.join(t.path, 'node_modules');
			if (!existsSync(modules)) continue;
			const prs = gh(
				`repos/${repo}/pulls?state=all&head=${owner}:${encodeURIComponent(t.branch)}`
			);
			if (prs.length && prs.every((p) => p.state === 'closed')) {
				rmSync(modules, { recursive: true, force: true });
				pruned.push(t.path);
			}
		}
		return {
			result: { pruned },
			text: pruned.length ? pruned.join('\n') : 'nothing to prune'
		};
	},

	ready(args) {
		if (!args.length) throw new Error('missing <pr>');
		const repo = repoSlug();
		const isOwned = codeownersMatcher(
			readFileSync(path.join(ROOT, '.github/CODEOWNERS'), 'utf8')
		);
		const results = args.map(prNumber).map((n) => {
			const pr = gh(`repos/${repo}/pulls/${n}`);
			return evaluateReadiness({
				pr,
				checks: checksFor(repo, pr.head.sha),
				botComments: gh(
					`repos/${repo}/issues/${n}/comments?per_page=100`
				).filter((c) => c.user.login === 'claude[bot]'),
				files: gh(`repos/${repo}/pulls/${n}/files?per_page=100`).map(
					(f) => f.filename
				),
				isOwned
			});
		});
		const text = results
			.map(
				(r) =>
					`#${r.number} ${r.ready ? 'ready' : 'not ready'}${r.reasons.map((x) => `\n  ${x}`).join('')}`
			)
			.join('\n');
		return {
			result: results,
			text,
			code: results.every((r) => r.ready) ? 0 : 1
		};
	},

	conflicts() {
		const repo = repoSlug();
		const open = gh(`repos/${repo}/pulls?state=open&per_page=100`);
		const stale = open
			.map((p) => gh(`repos/${repo}/pulls/${p.number}`))
			.filter((p) => p.mergeable === false || p.mergeable_state === 'behind')
			.map((p) => ({
				number: p.number,
				branch: p.head.ref,
				state: p.mergeable === false ? 'conflict' : 'behind'
			}));
		return {
			result: stale,
			text: stale.length
				? stale.map((p) => `#${p.number} ${p.state} ${p.branch}`).join('\n')
				: 'no open PR needs a rebase'
		};
	},

	rebase() {
		const cwd = process.cwd();
		const branch = run('git', ['branch', '--show-current'], { cwd });
		if (!branch || branch === 'main')
			throw new Error('run this in a PR worktree, not on main');
		run('git', ['fetch', '-q', 'origin', 'main'], { cwd });
		const res = spawnSync('git', ['rebase', '-q', 'origin/main'], {
			cwd,
			encoding: 'utf8'
		});
		if (res.status !== 0) {
			const files = run('git', ['diff', '--name-only', '--diff-filter=U'], {
				cwd
			})
				.split('\n')
				.filter(Boolean);
			return {
				result: { branch, rebased: false, conflicts: files },
				text: `conflicts, fix them then git rebase --continue:\n${files.join('\n')}`,
				code: 1
			};
		}
		run('git', ['push', '-q', '--force-with-lease', 'origin', branch], { cwd });
		return {
			result: { branch, rebased: true },
			text: `${branch} rebased onto origin/main and pushed`
		};
	},

	attribution([arg], flags) {
		const n = prNumber(arg);
		const repo = repoSlug();
		const pr = gh(`repos/${repo}/pulls/${n}`);
		if (flags.has('--clean'))
			return {
				result: { body: stripAttribution(pr.body) },
				text: stripAttribution(pr.body)
			};
		const found = [
			...findAttribution(pr.body).map((line) => ({ where: 'body', line })),
			...gh(`repos/${repo}/issues/${n}/comments?per_page=100`).flatMap((c) =>
				findAttribution(c.body).map((line) => ({
					where: `comment ${c.id}`,
					line
				}))
			),
			...gh(`repos/${repo}/pulls/${n}/comments?per_page=100`).flatMap((c) =>
				findAttribution(c.body).map((line) => ({
					where: `review comment ${c.id}`,
					line
				}))
			),
			...gh(`repos/${repo}/pulls/${n}/commits?per_page=100`).flatMap((c) =>
				findAttribution(c.commit.message).map((line) => ({
					where: `commit ${c.sha.slice(0, 8)}`,
					line
				}))
			)
		];
		return {
			result: found,
			text: found.length
				? found.map((f) => `${f.where}: ${f.line}`).join('\n')
				: 'no attribution',
			code: found.length ? 1 : 0
		};
	}
};

function main(argv) {
	const flags = new Set(argv.filter((a) => a.startsWith('--')));
	const [name, ...args] = argv.filter((a) => !a.startsWith('--'));
	if (!name || !commands[name]) {
		console.log(HELP.main);
		return name && !flags.has('--help') ? 1 : 0;
	}
	if (flags.has('--help')) {
		console.log(HELP[name]);
		return 0;
	}
	try {
		const { result, text, code = 0 } = commands[name](args, flags);
		console.log(flags.has('--json') ? JSON.stringify(result, null, 2) : text);
		return code;
	} catch (err) {
		const message = err.stderr?.toString().trim() || err.message;
		console.error(
			flags.has('--json')
				? JSON.stringify({ error: message })
				: `agent-cli ${name}: ${message}`
		);
		return 2;
	}
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	process.exitCode = main(process.argv.slice(2));
}
