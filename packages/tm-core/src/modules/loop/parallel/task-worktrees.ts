/**
 * @fileoverview Git operations for `loop --parallel`: the clean-tree check,
 * one worktree and branch per task, and removing the ones nobody used.
 *
 * Every call goes through runGit, and the branch names and paths it gets
 * come from parallel-plan.ts, which only builds them from checked task IDs.
 */

import fs from 'node:fs';
import path from 'node:path';
import { gitRef, runGit } from '../../../common/utils/git-utils.js';
import { ParallelLoopError } from './parallel-plan.js';

/** What a task's worktree holds once its Claude Code process is done */
export interface WorktreeWork {
	/** Commits on the branch that the starting commit doesn't have */
	commits: number;
	/** Uncommitted changes, untracked files included */
	uncommitted: boolean;
}

const lstatOrNull = (p: string): fs.Stats | null => {
	try {
		return fs.lstatSync(p);
	} catch {
		return null;
	}
};

/** Same path whatever the symlinks (macOS /var vs /private/var) */
function canonical(p: string): string {
	try {
		return fs.realpathSync(p);
	} catch {
		// Missing: resolve the part that exists, as git does for a worktree
		// whose folder is gone
		const parent = path.dirname(p);
		return parent === p
			? path.resolve(p)
			: path.join(canonical(parent), path.basename(p));
	}
}

/**
 * Paths from `git status --porcelain=v1 -z`. A rename or copy entry carries
 * its source path in the next field, which is skipped.
 */
export function parsePorcelainPaths(output: string): string[] {
	const fields = output.split('\0');
	const paths: string[] = [];
	for (let i = 0; i < fields.length; i++) {
		const entry = fields[i];
		if (entry.length < 4) continue;
		paths.push(entry.slice(3));
		if (entry[0] === 'R' || entry[0] === 'C') i++;
	}
	return paths;
}

/** `git worktree list --porcelain` as worktree path to branch ref (or null) */
export function parseWorktreeList(output: string): Map<string, string | null> {
	const worktrees = new Map<string, string | null>();
	let current: string | null = null;
	for (const line of output.split('\n')) {
		if (line.startsWith('worktree ')) {
			current = line.slice('worktree '.length);
			worktrees.set(current, null);
		} else if (line.startsWith('branch ') && current !== null) {
			worktrees.set(current, line.slice('branch '.length));
		}
	}
	return worktrees;
}

/** Second line of a branch record whose Claude Code ended without an error */
const FINISHED = 'finished';

/**
 * TaskGraph's own files that change while tasks are claimed and worked on,
 * relative to the project: they don't count as uncommitted work. Anything
 * else under `.taskgraph/` (config, docs, templates) does, because the
 * worktrees start from the last commit and wouldn't have it.
 */
const OWN_STATE_PATHS = ['.taskgraph/tasks/', '.taskgraph/state.json'];

/** How `git status` names a `.taskgraph/` folder that was never committed (#1003) */
const UNTRACKED_STATE_FOLDER = '.taskgraph/';

/** Whether `file` (relative to the repository root) is TaskGraph's own state */
export function isTaskGraphState(file: string, projectPrefix: string): boolean {
	const prefix = projectPrefix ? `${projectPrefix}/` : '';
	if (file === prefix + UNTRACKED_STATE_FOLDER) return true;
	return OWN_STATE_PATHS.some((own) =>
		own.endsWith('/') ? file.startsWith(prefix + own) : file === prefix + own
	);
}

export class TaskWorktrees {
	/** The project folder with symlinks resolved, so paths compare with git's */
	private readonly projectRoot: string;

	constructor(projectRoot: string) {
		this.projectRoot = canonical(projectRoot);
	}

	private async git(
		args: string[],
		cwd = this.projectRoot,
		env?: NodeJS.ProcessEnv
	): Promise<string> {
		// No time limit: `worktree add`, `merge` and `checkout` run the user's
		// hooks (an npm install, a test suite), and killing one leaves a
		// half-made worktree or a merge in progress
		return (await runGit(args, { cwd, timeoutMs: 0, env })).stdout;
	}

	/**
	 * For `worktree add` and `merge`: their hooks may fetch (submodules, an
	 * npm install), and start the repository's programs with or without
	 * runGit's transport guard, so the user's own setting stands
	 */
	private hookEnv(): NodeJS.ProcessEnv {
		return { GIT_ALLOW_PROTOCOL: process.env.GIT_ALLOW_PROTOCOL };
	}

	private async succeeds(
		args: string[],
		env?: NodeJS.ProcessEnv
	): Promise<boolean> {
		try {
			await this.git(args, this.projectRoot, env);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * The commit every task branch starts from.
	 * @throws ParallelLoopError outside a git repository or before the first commit
	 */
	async head(): Promise<string> {
		try {
			return (
				await this.git(['rev-parse', '--verify', 'HEAD^{commit}'])
			).trim();
		} catch {
			throw new ParallelLoopError(
				"--parallel needs a git repository with at least one commit, and this project doesn't have one",
				'Run `git init` and commit your work, then try again'
			);
		}
	}

	/**
	 * Files with uncommitted changes to tracked files, relative to the
	 * repository root. Changes to the task files and state.json don't count:
	 * claims and status changes write there.
	 */
	async uncommittedFiles(): Promise<string[]> {
		return (await this.changes('no')).files;
	}

	/**
	 * Uncommitted changes, untracked files included, relative to the project
	 * folder. Leaves out TaskGraph's state and `except` (the loop's progress
	 * file), which the loop writes itself.
	 */
	async changedFiles(except: string): Promise<string[]> {
		const { top, files } = await this.changes('normal');
		const skip = canonical(except);
		return files
			.map((file) => path.join(top, file))
			.filter((file) => file !== skip)
			.map((file) =>
				path.relative(this.projectRoot, file).split(path.sep).join('/')
			);
	}

	/** `git status` paths relative to the repository root, TaskGraph's state left out */
	private async changes(
		untracked: 'no' | 'normal'
	): Promise<{ top: string; files: string[] }> {
		const top = canonical(
			(await this.git(['rev-parse', '--show-toplevel'])).trim()
		);
		const project = path
			.relative(top, this.projectRoot)
			.split(path.sep)
			.join('/');
		const output = await this.git([
			'status',
			'--porcelain=v1',
			'-z',
			`--untracked-files=${untracked}`
		]);
		const files = parsePorcelainPaths(output).filter(
			(file) => !isTaskGraphState(file, project)
		);
		return { top, files };
	}

	/**
	 * Refuse to start when tracked files have uncommitted changes: the
	 * worktrees start from the last commit and wouldn't have them.
	 */
	async assertClean(): Promise<void> {
		const files = await this.uncommittedFiles();
		if (files.length === 0) return;
		const shown = files.slice(0, 3).join(', ');
		const more = files.length > 3 ? ` and ${files.length - 3} more` : '';
		throw new ParallelLoopError(
			`Uncommitted changes in ${shown}${more}; the task worktrees start from the last commit and wouldn't have them`,
			'Commit or stash them (`git stash`), then run `taskgraph loop --parallel` again'
		);
	}

	/**
	 * The project's folder inside a worktree: the worktree itself, unless
	 * the project sits in a subfolder of the repository
	 */
	async projectIn(worktree: string): Promise<string> {
		const top = canonical(
			(await this.git(['rev-parse', '--show-toplevel'])).trim()
		);
		return path.join(worktree, path.relative(top, this.projectRoot));
	}

	/**
	 * Make the folder the task worktrees and logs go in. It must be a real
	 * folder: a symlink there (one committed to the repository, say) would
	 * send the worktrees and Claude's output somewhere else.
	 * @throws ParallelLoopError when it's a symlink or a file
	 */
	prepareWorktreesDir(dir: string): void {
		let stat: fs.Stats | undefined;
		try {
			stat = fs.lstatSync(dir);
		} catch {
			// Not there yet
		}
		if (stat && (stat.isSymbolicLink() || !stat.isDirectory())) {
			throw new ParallelLoopError(
				`${path.relative(this.projectRoot, dir)} is ${stat.isSymbolicLink() ? 'a symlink' : 'not a folder'}; task worktrees and logs go there`,
				'Remove it, then run `taskgraph loop --parallel` again'
			);
		}
		fs.mkdirSync(dir, { recursive: true });
	}

	/** Keep the worktrees folder out of the main checkout's `git status` */
	async ignoreWorktreesDir(dir: string): Promise<void> {
		const exclude = path.resolve(
			this.projectRoot,
			(await this.git(['rev-parse', '--git-path', 'info/exclude'])).trim()
		);
		const top = canonical(
			(await this.git(['rev-parse', '--show-toplevel'])).trim()
		);
		const rel = path.relative(top, canonical(dir)).split(path.sep).join('/');
		const line = `/${rel}/`;
		let current = '';
		try {
			current = fs.readFileSync(exclude, 'utf8');
		} catch {
			// No exclude file yet
		}
		if (current.split(/\r?\n/).includes(line)) return;
		fs.mkdirSync(path.dirname(exclude), { recursive: true });
		const sep = current && !current.endsWith('\n') ? '\n' : '';
		fs.appendFileSync(exclude, `${sep}${line}\n`);
	}

	private async worktreeBranches(): Promise<Map<string, string | null>> {
		const listed = parseWorktreeList(
			await this.git(['worktree', 'list', '--porcelain'])
		);
		return new Map([...listed].map(([p, ref]) => [canonical(p), ref]));
	}

	/**
	 * Make the task's worktree on its branch. Picks up where an earlier run
	 * left off: an existing worktree on the same branch is reused, and an
	 * existing branch is checked out rather than recreated, also when the
	 * worktree's folder was deleted by hand.
	 * @returns Whether this call created the branch
	 * @throws ParallelLoopError when the path holds something else
	 */
	async add(
		worktree: string,
		branch: string,
		base: string
	): Promise<{ createdBranch: boolean }> {
		const listed = canonical(worktree);
		let existing = (await this.worktreeBranches()).get(listed);
		// Deleted by hand (`rm -rf`, not `git worktree remove`): git still lists
		// it, so drop that record and make the worktree again (#1104). Not
		// `git worktree prune`: that drops every worktree whose folder is away,
		// one on an unplugged drive too, with what was staged in it
		if (existing !== undefined && !lstatOrNull(worktree)) {
			await this.git(['worktree', 'remove', '--force', listed]);
			existing = undefined;
		}
		if (existing !== undefined) {
			if (existing === `refs/heads/${branch}`) return { createdBranch: false };
			throw new ParallelLoopError(
				`${worktree} is a worktree for another branch`,
				`Remove it with \`git worktree remove ${worktree}\``
			);
		}
		if (lstatOrNull(worktree)) {
			throw new ParallelLoopError(
				`${worktree} already exists and isn't a git worktree`,
				'Move or delete it, then try again'
			);
		}
		fs.mkdirSync(path.dirname(worktree), { recursive: true });
		if (await this.branchExists(branch)) {
			await this.git(
				['worktree', 'add', '--quiet', worktree, gitRef(branch)],
				this.projectRoot,
				this.hookEnv()
			);
			return { createdBranch: false };
		}
		await this.git(
			[
				'worktree',
				'add',
				'--quiet',
				'-b',
				gitRef(branch),
				worktree,
				gitRef(base)
			],
			this.projectRoot,
			this.hookEnv()
		);
		return { createdBranch: true };
	}

	/** `user.name` and `user.email`, or undefined when either isn't set */
	async identity(): Promise<{ name: string; email: string } | undefined> {
		const get = (key: string) =>
			this.git(['config', '--get', key]).then(
				(v) => v.trim(),
				() => ''
			);
		const [name, email] = await Promise.all([
			get('user.name'),
			get('user.email')
		]);
		return name && email ? { name, email } : undefined;
	}

	/** `sha1` or `sha256` */
	async objectFormat(): Promise<string> {
		return (await this.git(['rev-parse', '--show-object-format'])).trim();
	}

	/** The commit `branch` points at, or undefined when there's no such branch */
	private async tip(branch: string): Promise<string | undefined> {
		return this.git([
			'rev-parse',
			'--verify',
			'--quiet',
			`refs/heads/${branch}^{commit}`
		]).then(
			(sha) => sha.trim(),
			() => undefined
		);
	}

	/** Where the tip a run left `branch` at is kept, inside the git folder */
	private async recordFile(branch: string): Promise<string> {
		const common = path.resolve(
			this.projectRoot,
			(await this.git(['rev-parse', '--git-common-dir'])).trim()
		);
		return path.join(common, 'taskgraph', 'branches', branch);
	}

	/**
	 * Note where this run left `branch` (or that it's gone), so the next run
	 * can pick it up again: see assertBranchReusable. `finished`: its Claude
	 * Code ended without an error, so `--merge` may merge it (isWhereRunLeft)
	 */
	async recordBranch(branch: string, finished = false): Promise<void> {
		const [file, tip] = await Promise.all([
			this.recordFile(branch),
			this.tip(branch)
		]);
		if (!tip) {
			fs.rmSync(file, { force: true });
			return;
		}
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, finished ? `${tip}\n${FINISHED}` : tip);
	}

	/**
	 * Claude runs in the task branch with the files on it, and `loop --trust`
	 * approved only the ones in this checkout. So a branch that's already
	 * here is used only when it's at `base` or where an earlier run left it
	 * (recordBranch); any other commits on it (`gh pr checkout`, a pull, a
	 * `--container` run, a commit of your own) weren't approved.
	 *
	 * `resumeIn` is the task worktree when this run took over its own dead
	 * run's claim: that run's worker committed there after the last record
	 * (a crash skipped settle), so a tip that still has the recorded one as
	 * an ancestor, checked out in that worktree, is its work.
	 * @throws ParallelLoopError naming the branch and how to set it aside
	 */
	async assertBranchReusable(
		branch: string,
		base: string,
		resumeIn?: string
	): Promise<void> {
		const tip = await this.tip(branch);
		if (tip === undefined || tip === base) return;
		const recorded = (await this.recorded(branch)).tip;
		if (recorded === tip) return;
		if (
			recorded &&
			resumeIn &&
			(await this.worktreeBranches()).get(canonical(resumeIn)) ===
				`refs/heads/${branch}` &&
			(await this.succeeds(['merge-base', '--is-ancestor', recorded, tip]))
		) {
			return;
		}
		throw new ParallelLoopError(
			`${branch} already exists with commits the loop didn't record (made outside a run, or by a --container run), so its files weren't approved. Review it with \`git diff ${base} ${branch}\`, then rename it (\`git branch -m ${branch} <new-name>\`) or delete it (\`git branch -D ${branch}\`, after \`git worktree remove\` if a worktree has it), and run again`
		);
	}

	/** What recordBranch noted for `branch`: its tip ('' when there's none) and whether it was finished */
	private async recorded(
		branch: string
	): Promise<{ tip: string; finished: boolean }> {
		const [tip = '', mark] = await fs.promises
			.readFile(await this.recordFile(branch), 'utf8')
			.then(
				(s) => s.trim().split('\n'),
				() => []
			);
		return { tip, finished: mark === FINISHED };
	}

	/**
	 * `branch` exists and is at the commit a run left it at, after its Claude
	 * Code ended without an error (recordBranch). Not so while its worker is
	 * still running in another run, nor after one that failed or was stopped.
	 */
	async isWhereRunLeft(branch: string): Promise<boolean> {
		const tip = await this.tip(branch);
		const recorded = await this.recorded(branch);
		return tip !== undefined && recorded.finished && tip === recorded.tip;
	}

	async branchExists(branch: string): Promise<boolean> {
		return (await this.tip(branch)) !== undefined;
	}

	/**
	 * A standalone clone for a container worker, holding only `start` (no
	 * other branches, no tags) on `branch`. The objects come through git's
	 * transport: no hardlinks into this repository and no alternates.
	 */
	async cloneFor(clone: string, branch: string, start: string): Promise<void> {
		const top = (await this.git(['rev-parse', '--show-toplevel'])).trim();
		const sha = (
			await this.git(['rev-parse', '--verify', `${start}^{commit}`])
		).trim();
		await this.git([
			'init',
			'--quiet',
			`--object-format=${await this.objectFormat()}`,
			clone
		]);
		await this.git(
			[
				'fetch',
				'--quiet',
				'--no-tags',
				'--',
				top,
				`${sha}:refs/heads/${branch}`
			],
			clone,
			{ GIT_ALLOW_PROTOCOL: 'file' }
		);
		await this.git(['checkout', '--quiet', branch], clone);
	}

	/**
	 * Bring a worker's branch into this repository. Run here, never in the
	 * clone; the caller has already replaced the clone's config and removed
	 * its hooks (sanitizeClone). Not forced, so a rewritten history is
	 * refused rather than replacing the branch.
	 */
	async fetchFromClone(clone: string, branch: string): Promise<void> {
		await runGit(
			[
				'-c',
				'core.hooksPath=/dev/null',
				'-c',
				'transfer.fsckObjects=true',
				'fetch',
				'--quiet',
				'--no-tags',
				'--no-recurse-submodules',
				'--no-write-fetch-head',
				'--',
				clone,
				`refs/heads/${branch}:refs/heads/${branch}`
			],
			{
				cwd: this.projectRoot,
				timeoutMs: 10 * 60_000,
				// shortcut: with the file transport on, git before 2.45 (no
				// GIT_NO_LAZY_FETCH) can still start a partial-clone remote's
				// program in this fetch and cloneFor's; needs a git version gate
				env: { GIT_ALLOW_PROTOCOL: 'file' }
			}
		);
	}

	/** Commits on `branch` that `base` doesn't have (0 without the branch) */
	async commitsSince(branch: string, base: string): Promise<number> {
		const count = await this.git([
			'rev-list',
			'--count',
			`${base}..refs/heads/${branch}`
		]).catch(() => '0');
		return Number.parseInt(count.trim(), 10) || 0;
	}

	/**
	 * Merge a task branch into the current branch (--merge)
	 * @returns false, with the merge undone, when it conflicts or fails
	 */
	async merge(branch: string): Promise<boolean> {
		if (
			await this.succeeds(
				['merge', '--no-edit', gitRef(branch)],
				this.hookEnv()
			)
		) {
			return true;
		}
		await this.succeeds(['merge', '--abort']);
		return false;
	}

	/**
	 * Keep a conflicting task branch's work as `<branch>-conflict-<n>` and
	 * remove its worktree, so the task can start again from the current commit
	 * @returns The name the work was kept under, or undefined (nothing
	 *   changed) when the worktree has uncommitted changes
	 */
	async setAside(
		worktree: string,
		branch: string
	): Promise<string | undefined> {
		if (!(await this.removeWorktree(worktree))) return;
		let n = 1;
		while (await this.branchExists(`${branch}-conflict-${n}`)) n++;
		const kept = `${branch}-conflict-${n}`;
		await this.git(['branch', '-m', gitRef(branch), gitRef(kept)]);
		return kept;
	}

	/**
	 * `git worktree remove`, never forced. A path git has no worktree for
	 * (a `--container` task's clone) counts as already removed (#1068).
	 */
	private async removeWorktree(worktree: string): Promise<boolean> {
		if (!(await this.worktreeBranches()).has(canonical(worktree))) return true;
		return this.succeeds(['worktree', 'remove', worktree]);
	}

	async deleteBranch(branch: string): Promise<void> {
		await this.succeeds(['branch', '-d', gitRef(branch)]);
	}

	/** Commits and uncommitted changes in a task's worktree */
	async work(
		worktree: string,
		branch: string,
		base: string
	): Promise<WorktreeWork> {
		const [count, status] = await Promise.all([
			this.git(['rev-list', '--count', `${base}..refs/heads/${branch}`]).catch(
				() => '0'
			),
			this.git(['status', '--porcelain'], worktree).catch(() => '')
		]);
		return {
			commits: Number.parseInt(count.trim(), 10) || 0,
			uncommitted: status.trim().length > 0
		};
	}

	/**
	 * Remove a worktree nobody used, and its branch when this run made it.
	 * Never forces: anything git would refuse to drop stays.
	 * @returns Whether the worktree is gone
	 */
	async remove(
		worktree: string,
		branch: string,
		deleteBranch: boolean
	): Promise<boolean> {
		if (!(await this.removeWorktree(worktree))) return false;
		if (deleteBranch) await this.succeeds(['branch', '-d', gitRef(branch)]);
		return true;
	}
}
