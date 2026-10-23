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

export class TaskWorktrees {
	constructor(private readonly projectRoot: string) {}

	private async git(args: string[], cwd = this.projectRoot): Promise<string> {
		const { stdout } = await run('git', args, {
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
	 * repository root. Changes under the project's `.taskgraph/` don't count:
	 * claims and status changes write there.
	 */
	async uncommittedFiles(): Promise<string[]> {
		const top = canonical(
			(await this.git(['rev-parse', '--show-toplevel'])).trim()
		);
		const own = path
			.relative(top, path.join(canonical(this.projectRoot), '.taskgraph'))
			.split(path.sep)
			.join('/');
		const output = await this.git([
			'status',
			'--porcelain=v1',
			'-z',
			'--untracked-files=no'
		]);
		return parsePorcelainPaths(output).filter(
			(file) => file !== own && !file.startsWith(`${own}/`)
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
		return path.join(worktree, path.relative(top, canonical(this.projectRoot)));
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
		if (fs.existsSync(worktree)) {
			throw new ParallelLoopError(
				`${worktree} already exists and isn't a git worktree`,
				'Move or delete it, then try again'
			);
		}
		fs.mkdirSync(path.dirname(worktree), { recursive: true });
		if (
			await this.succeeds([
				'rev-parse',
				'--verify',
				'--quiet',
				`refs/heads/${branch}`
			])
		) {
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
