/**
 * @fileoverview Git operations for `loop --parallel`: the clean-tree check,
 * one worktree and branch per task, and removing the ones nobody used.
 *
 * Every call runs `git` with an argv array through execFile, never a shell,
 * and the branch names and paths it gets come from parallel-plan.ts, which
 * only builds them from checked task IDs.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { ParallelLoopError } from './parallel-plan.js';

const run = promisify(execFile);

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
		return path.resolve(p);
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

/**
 * TaskGraph's own files that change while tasks are claimed and worked on,
 * relative to the project: they don't count as uncommitted work. Anything
 * else under `.taskgraph/` (config, docs, templates) does, because the
 * worktrees start from the last commit and wouldn't have it.
 */
const OWN_STATE_PATHS = ['.taskgraph/tasks/', '.taskgraph/state.json'];

/** Whether `file` (relative to the repository root) is TaskGraph's own state */
export function isTaskGraphState(file: string, projectPrefix: string): boolean {
	const prefix = projectPrefix ? `${projectPrefix}/` : '';
	return OWN_STATE_PATHS.some((own) =>
		own.endsWith('/') ? file.startsWith(prefix + own) : file === prefix + own
	);
}

/**
 * What Claude Code loads and `loop --trust` approves, lowercased, matched at
 * any depth; keep in step with CLAUDE_FILES, LOCAL_FILES and `.claude` in
 * ../loop-trust.ts
 */
const LOADED_PATHS = [
	'claude.md',
	'claude.local.md',
	'.claude',
	'.mcp.json',
	'.taskgraph/config.json',
	'.taskgraph/config.local.json',
	'.taskgraph/reports'
];

/** Whether `file` (from `git diff --name-only`) is, or is inside, one of LOADED_PATHS */
function isLoadedByClaude(file: string): boolean {
	const padded = `/${file.toLowerCase()}/`;
	return LOADED_PATHS.some((p) => padded.includes(`/${p}/`));
}

export class TaskWorktrees {
	/** The project folder with symlinks resolved, so paths compare with git's */
	private readonly projectRoot: string;

	constructor(projectRoot: string) {
		this.projectRoot = canonical(projectRoot);
	}

	private async git(args: string[], cwd = this.projectRoot): Promise<string> {
		// No program named by repository config, no bare repository found by walking up
		const hardened = [
			'-c',
			'safe.bareRepository=explicit',
			'-c',
			'core.fsmonitor=false',
			...args
		];
		const { stdout } = await run('git', hardened, {
			cwd,
			encoding: 'utf8',
			maxBuffer: 16 * 1024 * 1024
		});
		return stdout;
	}

	private async succeeds(args: string[]): Promise<boolean> {
		try {
			await this.git(args);
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
			'--untracked-files=no'
		]);
		return parsePorcelainPaths(output).filter(
			(file) => !isTaskGraphState(file, project)
		);
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
	 * existing branch is checked out rather than recreated.
	 * @returns Whether this call created the branch
	 * @throws ParallelLoopError when the path holds something else
	 */
	async add(
		worktree: string,
		branch: string,
		base: string
	): Promise<{ createdBranch: boolean }> {
		const existing = (await this.worktreeBranches()).get(canonical(worktree));
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
			await this.git(['worktree', 'add', '--quiet', worktree, branch]);
			return { createdBranch: false };
		}
		await this.git([
			'worktree',
			'add',
			'--quiet',
			'-b',
			branch,
			worktree,
			base
		]);
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
	 * can pick it up again: see assertBranchReusable
	 */
	async recordBranch(branch: string): Promise<void> {
		const [file, tip] = await Promise.all([
			this.recordFile(branch),
			this.tip(branch)
		]);
		if (!tip) {
			fs.rmSync(file, { force: true });
			return;
		}
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, tip);
	}

	/**
	 * Files in LOADED_PATHS that `tip` changed since it left `base`'s history,
	 * or undefined when they share no history
	 */
	private async loadedChanges(
		base: string,
		tip: string
	): Promise<string[] | undefined> {
		try {
			const fork = (await this.git(['merge-base', base, tip])).trim();
			// --no-renames: a rename would list only the new name, not CLAUDE.md
			const out = await this.git([
				'diff',
				'--name-only',
				'-z',
				'--no-renames',
				'--no-relative',
				fork,
				tip,
				'--'
			]);
			return out.split('\0').filter((f) => f && isLoadedByClaude(f));
		} catch {
			return undefined;
		}
	}

	/**
	 * Claude runs in the task branch with the files on it, and `loop --trust`
	 * approved only the ones in this checkout. So a branch that's already
	 * here is used when it's at `base`, where an earlier run left it
	 * (recordBranch), or when its commits leave every file Claude Code loads
	 * as it was (a branch kept from an older version, a crash, a commit of
	 * your own); not when they change one, as `gh pr checkout` or a pull can.
	 * @throws ParallelLoopError naming the files and how to set the branch aside
	 */
	async assertBranchReusable(branch: string, base: string): Promise<void> {
		const tip = await this.tip(branch);
		if (tip === undefined || tip === base) return;
		const recorded = await fs.promises
			.readFile(await this.recordFile(branch), 'utf8')
			.then(
				(s) => s.trim(),
				() => ''
			);
		if (recorded === tip) return;
		const changed = await this.loadedChanges(base, tip);
		if (changed?.length === 0) return;
		const what = changed
			? `changes ${changed.slice(0, 5).join(', ')}${changed.length > 5 ? ` and ${changed.length - 5} more` : ''}, which Claude Code loads`
			: 'shares no history with your current commit';
		const review = changed
			? `git diff ${base}...${branch}`
			: `git log -p ${branch}`;
		throw new ParallelLoopError(
			`${branch} already exists and ${what}, so its files weren't approved. Review it with \`${review}\`, then rename it (\`git branch -m ${branch} <new-name>\`) or delete it (\`git branch -D ${branch}\`, after \`git worktree remove\` if a worktree has it), and run again`
		);
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
			clone
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
		await run(
			'git',
			[
				'-c',
				'core.fsmonitor=false',
				'-c',
				'core.hooksPath=/dev/null',
				'-c',
				'protocol.file.allow=always',
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
				encoding: 'utf8',
				timeout: 10 * 60_000,
				// upload-pack sets this itself; said again so nothing undoes it
				env: { ...process.env, GIT_NO_LAZY_FETCH: '1' }
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

	async deleteBranch(branch: string): Promise<void> {
		await this.succeeds(['branch', '-d', branch]);
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
		if (!(await this.succeeds(['worktree', 'remove', worktree]))) return false;
		if (deleteBranch) await this.succeeds(['branch', '-d', branch]);
		return true;
	}
}
