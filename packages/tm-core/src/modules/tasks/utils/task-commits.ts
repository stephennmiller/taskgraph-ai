/**
 * @fileoverview The commits that implemented a task (#954). The loop's
 * presets end each commit message with `[task <id>]` (`[task <tag>/<id>]`
 * outside master), so finding them is one `git log --grep`: nothing is
 * stored, and a rebase or squash that keeps the message keeps the link.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface TaskCommit {
	sha: string;
	subject: string;
}

/**
 * How a commit message names task `id`: the bare ID in master, so commits
 * from before tags were in the marker still link, `<tag>/<id>` in any other
 * tag, since every tag numbers its tasks from 1 (#1015)
 */
const taskCommitRef = (id: string, tag?: string): string =>
	!tag || tag === 'master' ? id : `${tag}/${id}`;

/** What a commit message carries to link it to task `id` in `tag` */
export const taskCommitTag = (id: string, tag?: string): string =>
	`[task ${taskCommitRef(id, tag)}]`;

/** Instructions that say `[task <id>` with the marker for `tag` instead */
export const withTagMarker = (text: string, tag?: string): string =>
	text.replaceAll('[task <id>', `[task ${taskCommitRef('<id>', tag)}`);

/** Newest first; this many is enough to see what a task changed */
const MAX_COMMITS = 20;

/**
 * Commits whose message names task `id` in `tag` or one of its subtasks
 * (`[task 3.1]` for 3), newest first. `since` (the task's createdAt) leaves
 * out commits for an earlier task that had the same ID. Empty outside a git
 * repository or when git fails: a missing history never stops `show`.
 */
export async function findTaskCommits(
	projectRoot: string,
	id: string,
	options: { tag?: string; since?: string } = {}
): Promise<TaskCommit[]> {
	// createdAt comes from the user's file: an unparsable one bounds nothing
	const since = Date.parse(options.since ?? '');
	try {
		const { stdout } = await run(
			'git',
			[
				// No program named by repository config, no bare repository found by walking up
				'-c',
				'safe.bareRepository=explicit',
				'-c',
				'core.fsmonitor=false',
				'log',
				'--fixed-strings',
				// Several --grep match any of them
				`--grep=${taskCommitTag(id, options.tag)}`,
				`--grep=[task ${taskCommitRef(id, options.tag)}.`,
				...(Number.isNaN(since)
					? []
					: [`--since=${new Date(since).toISOString()}`]),
				`--max-count=${MAX_COMMITS}`,
				'--format=%h%x09%s'
			],
			{ cwd: projectRoot, encoding: 'utf8', timeout: 5000 }
		);
		return stdout
			.split('\n')
			.filter(Boolean)
			.map((line) => {
				const tab = line.indexOf('\t');
				return { sha: line.slice(0, tab), subject: line.slice(tab + 1) };
			});
	} catch {
		return [];
	}
}
