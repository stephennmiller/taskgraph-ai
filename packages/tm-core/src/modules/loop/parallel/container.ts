/**
 * @fileoverview `loop --parallel --container`: the pure rules. Which flags,
 * tokens, images and paths it accepts, the `docker run` argv for one task,
 * the minimal git config the host writes into a worker's clone, and how a
 * task's status is read back from the worker's untrusted tasks.json.
 *
 * Each worker gets its own standalone clone and a copy of the project's
 * TaskGraph files, and the container mounts only those two folders. The host
 * never mounts its own `.git` or tasks.json, and never runs git in a clone
 * until it has replaced the clone's config and removed its hooks (see
 * container-workers.ts).
 */

import { TASK_STATUSES } from '../../../common/constants/index.js';
import type { TaskStatus } from '../../../common/types/index.js';
import { PROJECT_ROOT_ENV } from '../../../common/utils/project-root-finder.js';
import { ParallelLoopError } from './parallel-plan.js';

/** Has Node.js, git and Claude Code; taskgraph is installed on start */
export const DEFAULT_CONTAINER_IMAGE = 'docker/sandbox-templates:claude-code';

export const CONTAINER_RUNTIME = 'docker';

/** Claude Code reads either; the first one set is passed in */
const TOKEN_VARS = ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY'];

/** The worker's tasks.json is read back only up to this size */
export const MAX_IMPORTED_TASKS_BYTES = 32 * 1024 * 1024;

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
			'Add --container, e.g. `taskgraph loop --parallel 3 --container`'
		);
	}
	if (flags.container && flags.parallel === undefined) {
		throw new ParallelLoopError(
			'--container only works with --parallel',
			'Add --parallel, e.g. `taskgraph loop --parallel 3 --container`'
		);
	}
}

/**
 * The checks that need no I/O: platform, image name, token.
 * @returns The image to use and the name of the token variable
 * @throws ParallelLoopError for the first one that fails
 */
export function checkContainerSetup(options: {
	image?: string;
	env: Record<string, string | undefined>;
	platform: NodeJS.Platform;
}): { image: string; tokenVar: string } {
	if (options.platform === 'win32') {
		throw new ParallelLoopError(
			"--container doesn't run on Windows",
			'Run taskgraph inside WSL, or drop --container'
		);
	}
	const image = options.image?.trim() || DEFAULT_CONTAINER_IMAGE;
	// No leading `-` (it would be read as a docker flag), no spaces
	if (!/^[A-Za-z0-9][\w./:@-]*$/.test(image)) {
		throw new ParallelLoopError(
			`"${image}" isn't an image name`,
			'Pass a name like `my-image:1` to --container-image'
		);
	}
	const tokenVar = TOKEN_VARS.find((v) => options.env[v]?.trim());
	if (!tokenVar) {
		throw new ParallelLoopError(
			'--container needs CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY',
			'Run `claude setup-token`, then export CLAUDE_CODE_OAUTH_TOKEN'
		);
	}
	return { image, tokenVar };
}

/** The error for a runtime that isn't installed */
export function containerRuntimeMissing(runtime: string): ParallelLoopError {
	return new ParallelLoopError(
		`--container needs ${runtime}, and it isn't on PATH`,
		'Install Docker, or drop --container'
	);
}

/** The error for a runtime whose daemon doesn't answer */
export function containerRuntimeDown(runtime: string): ParallelLoopError {
	return new ParallelLoopError(
		`${runtime} is installed but isn't running`,
		'Start Docker and try again'
	);
}

/**
 * A host path that goes into a `--mount` value or the container's env.
 * @throws ParallelLoopError for a comma (splits --mount), a quote or a
 *   line break
 */
export function assertMountablePath(p: string): void {
	if (/[,"\r\n]/.test(p)) {
		throw new ParallelLoopError(
			`--container can't mount ${JSON.stringify(p)}: it has a comma, quote or line break`,
			'Move the project to a plainer path, or drop --container'
		);
	}
}

/**
 * The `.git/config` the host writes into a worker's clone, before the
 * container starts and again before fetching from it: nothing that runs a
 * command, only the format and the commit identity.
 */
export function cloneGitConfig(options: {
	objectFormat: string;
	userName: string;
	userEmail: string;
}): string {
	const sha256 = options.objectFormat === 'sha256';
	const quote = (v: string) =>
		`"${v.replace(/[\r\n]/g, ' ').replace(/[\\"]/g, '\\$&')}"`;
	return [
		'[core]',
		`\trepositoryformatversion = ${sha256 ? 1 : 0}`,
		'\tbare = false',
		...(sha256 ? ['[extensions]', '\tobjectformat = sha256'] : []),
		'[user]',
		`\tname = ${quote(options.userName)}`,
		`\temail = ${quote(options.userEmail)}`,
		''
	].join('\n');
}

/**
 * The status the worker gave its task, read from its own tasks.json, which
 * it fully controls: only this task's top-level `status`, and only a known
 * status. Anything else in the file is ignored.
 */
export function importedStatus(
	text: string,
	taskId: string,
	tag: string
): TaskStatus | undefined {
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		return undefined;
	}
	if (!data || typeof data !== 'object' || !Object.hasOwn(data, tag)) {
		return undefined;
	}
	const tasks = (data as Record<string, { tasks?: unknown }>)[tag]?.tasks;
	if (!Array.isArray(tasks)) return undefined;
	const task = tasks.find(
		(t) => t && typeof t === 'object' && String(t.id) === taskId
	);
	const status = task?.status;
	return TASK_STATUSES.includes(status) ? status : undefined;
}

export interface ContainerRun {
	image: string;
	/** From checkContainerSetup */
	tokenVar: string;
	/** `taskgraph-task-<id>-<random>`, so a stop can remove it by name */
	name: string;
	/** The worker's clone, symlinks resolved */
	clone: string;
	/** Where Claude starts: the project's folder inside the clone */
	cwd: string;
	/** Holds the worker's copy of the project's `.taskgraph` files */
	stateDir: string;
	prompt: string;
	/** npm spec for taskgraph when the image doesn't have it */
	taskgraphPackage: string;
	/** `uid:gid`, so the clone's files stay yours */
	user?: string;
}

// Installs taskgraph unless the image has it, runs Claude, then commits
// whatever Claude left uncommitted, so the host never needs `git status` in
// the clone. The prompt and package arrive as $1 and $2, never pasted into
// the script.
const START_SCRIPT = [
	'command -v taskgraph >/dev/null 2>&1 || {',
	'npm install --global --prefix /tmp/taskgraph --no-fund --no-audit --loglevel=error "$2" >&2 ||',
	'{ echo "Couldn\'t install $2 from npm; use --container-image with an image that has taskgraph" >&2; exit 1; };',
	'PATH="/tmp/taskgraph/bin:$PATH"; export PATH; };',
	'claude -p "$1" --dangerously-skip-permissions; code=$?;',
	'if [ -n "$(git status --porcelain)" ]; then',
	'git add -A && git commit -q -m "Uncommitted work left at the end of the run"; fi;',
	'exit $code'
].join(' ');

const mount = (src: string) => {
	assertMountablePath(src);
	return ['--mount', `type=bind,src=${src},dst=${src}`];
};

/** `docker run …` arguments (without `docker`) for one task */
export function buildContainerArgs(run: ContainerRun): string[] {
	assertMountablePath(run.cwd);
	return [
		'run',
		'--rm',
		'--init',
		'--name',
		run.name,
		...(run.user ? ['--user', run.user] : []),
		'--workdir',
		run.cwd,
		// By name: docker reads the value from its own environment
		'-e',
		run.tokenVar,
		'-e',
		`${PROJECT_ROOT_ENV}=${run.stateDir}`,
		// The image's home belongs to its own user, not the one --user names
		'-e',
		'HOME=/tmp',
		...mount(run.clone),
		...mount(run.stateDir),
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
