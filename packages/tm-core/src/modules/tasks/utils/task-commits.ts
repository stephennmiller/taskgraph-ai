/**
 * @fileoverview The commits that implemented a task (#954). The loop's
 * default preset ends each commit message with `[task <id>]`, so finding them
 * is one `git log --grep`: nothing is stored, and a rebase or squash that
 * keeps the message keeps the link.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface TaskCommit {
	sha: string;
	subject: string;
}

/** What a commit message carries to link it to task `id` */
export const taskCommitTag = (id: string): string => `[task ${id}]`;

/** Newest first; this many is enough to see what a task changed */
const MAX_COMMITS = 20;

/**
 * Commits whose message names task `id`, newest first. Empty outside a git
 * repository or when git fails: a missing history never stops `show`.
 */
export async function findTaskCommits(
	projectRoot: string,
	id: string
): Promise<TaskCommit[]> {
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
				`--grep=${taskCommitTag(id)}`,
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
