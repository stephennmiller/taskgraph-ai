/**
 * @fileoverview `loop --parallel --container`: the `docker run` argv for one
 * task's Claude Code process, and the checks that refuse to start without a
 * token or a runtime. Pure: the runner passes in what it found on disk.
 *
 * The container sees, at the same paths as the host (git's worktree links
 * are absolute):
 * - the task's worktree, read-write
 * - the main repository's `.git`, read-write so commits and branches work,
 *   with its config and hooks read-only over it, so a worker can't plant
 *   anything the host's git would run. (A read-only `.git` with only refs
 *   and objects writable breaks every ref update: git locks packed-refs in
 *   the `.git` folder itself.)
 * - the main project's `.taskgraph/tasks` read-write (claims, status, notes)
 *   and its config.json and state.json read-only
 *
 * Nothing else from the host. The token goes in as `-e NAME`, so docker
 * reads its value from the environment and it's never on a command line.
 */

import path from 'node:path';
import { ParallelLoopError } from './parallel-plan.js';

/** Has Node.js, git and Claude Code; taskgraph is installed on start */
export const DEFAULT_CONTAINER_IMAGE = 'docker/sandbox-templates:claude-code';

export const CONTAINER_RUNTIME = 'docker';

/**
 * `--container` only works with `--parallel`, and `--container-image` only
 * with `--container`.
 * @throws ParallelLoopError naming the flag that's missing
 */
export function assertContainerFlags(flags: {
	parallel?: string;
	container?: boolean;
	containerImage?: string;
}): void {
	if (flags.containerImage !== undefined && !flags.container) {
		throw new ParallelLoopError(
			'--container-image only works with --container',
			'Add --container, e.g. `taskgraph loop --parallel 3 --container --container-image <image>`'
		);
	}
	if (flags.container && flags.parallel === undefined) {
		throw new ParallelLoopError(
			'--container only works with --parallel',
			'Add --parallel, e.g. `taskgraph loop --parallel 3 --container`, or use --sandbox for a single loop'
		);
	}
}

/** Claude Code reads either; the first one set is passed in */
const TOKEN_VARS = ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY'];

/**
 * The name of the variable that carries Claude Code's credentials.
 * @throws ParallelLoopError when neither is set
 */
export function containerTokenVar(
	env: Record<string, string | undefined>
): string {
	const name = TOKEN_VARS.find((v) => env[v]?.trim());
	if (!name) {
		throw new ParallelLoopError(
			'--container needs CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY set: the containers get no access to your Claude Code login',
			'Run `claude setup-token` and export the token it prints as CLAUDE_CODE_OAUTH_TOKEN'
		);
	}
	return name;
}

/** The error for a runtime that isn't installed */
export function containerRuntimeMissing(runtime: string): ParallelLoopError {
	return new ParallelLoopError(
		`--container needs ${runtime}, and it isn't installed or isn't on PATH`,
		'Install Docker (https://docs.docker.com/get-started/get-docker/), or drop --container'
	);
}

export interface ContainerRun {
	image: string;
	/** From containerTokenVar */
	tokenVar: string;
	/** The main project, symlinks resolved */
	projectRoot: string;
	/** The task's worktree, symlinks resolved */
	worktree: string;
	/** Where Claude starts: the project's folder inside the worktree */
	cwd: string;
	/** `git rev-parse --git-common-dir`: the main repository's `.git` */
	gitCommonDir: string;
	prompt: string;
	/** npm spec for taskgraph when the image doesn't have it */
	taskgraphPackage: string;
	/** `uid:gid`, so git trusts the files and new ones are yours */
	user?: string;
	/** Whether a host path exists (config.json and state.json are optional) */
	exists: (p: string) => boolean;
}

// Installs taskgraph unless the image has it (this version, or the latest
// when this one isn't on npm), then hands over to Claude. The prompt and
// package arrive as $1 and $2, never pasted into the script
const NPM_INSTALL =
	'npm install --global --prefix /tmp/taskgraph --no-fund --no-audit --loglevel=error';
const START_SCRIPT = [
	'command -v taskgraph >/dev/null 2>&1 || {',
	`{ ${NPM_INSTALL} "$2" || ${NPM_INSTALL} taskgraph-ai; } >&2 || exit 1;`,
	'PATH="/tmp/taskgraph/bin:$PATH"; export PATH; };',
	'exec claude -p "$1" --dangerously-skip-permissions'
].join(' ');

function mount(src: string, readonly = false): string[] {
	// --mount is comma-separated; a comma in a path would split it
	if (src.includes(',')) {
		throw new ParallelLoopError(
			`--container can't mount ${src}: the path has a comma in it`,
			'Move the project to a path without commas, or drop --container'
		);
	}
	return [
		'--mount',
		`type=bind,src=${src},dst=${src}${readonly ? ',readonly' : ''}`
	];
}

/** `docker run …` arguments (without `docker`) for one task */
export function buildContainerArgs(run: ContainerRun): string[] {
	const tasksDir = path.join(run.projectRoot, '.taskgraph');
	const optional = ['config.json', 'state.json']
		.map((f) => path.join(tasksDir, f))
		.filter(run.exists);
	return [
		'run',
		'--rm',
		// Forwards the SIGTERM an abort sends to Claude
		'--init',
		...(run.user ? ['--user', run.user] : []),
		'--workdir',
		run.cwd,
		'-e',
		run.tokenVar,
		'-e',
		`TASKGRAPH_PROJECT_ROOT=${run.projectRoot}`,
		// The image's home belongs to its own user, not the one --user names
		'-e',
		'HOME=/tmp',
		...mount(run.worktree),
		...mount(run.gitCommonDir),
		...['config', 'hooks'].flatMap((f) =>
			mount(path.join(run.gitCommonDir, f), true)
		),
		...mount(path.join(tasksDir, 'tasks')),
		...optional.flatMap((f) => mount(f, true)),
		'--entrypoint',
		'sh',
		run.image,
		'-c',
		START_SCRIPT,
		'sh',
		run.prompt,
		run.taskgraphPackage
	];
}
