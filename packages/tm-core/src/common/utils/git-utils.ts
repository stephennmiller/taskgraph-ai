/**
 * @fileoverview Git utilities for TaskGraph
 * Git integration utilities using raw git commands and gh CLI
 */

import { type ChildProcess, exec, execFile } from 'child_process';
import { promisify } from 'util';
import { ERROR_CODES, errorWithHint } from '../errors/taskgraph-error.js';
import { formatTimeout } from './timeout-from-env.js';

const execAsync = promisify(exec);

/**
 * GitHub repository information
 */
export interface GitHubRepoInfo {
	name: string;
	owner: { login: string };
	defaultBranchRef: { name: string };
}

/**
 * Check if the specified directory is inside a git repository
 */
export async function isGitRepository(projectRoot: string): Promise<boolean> {
	if (!projectRoot) {
		throw new Error('projectRoot is required for isGitRepository');
	}

	try {
		await execAsync('git rev-parse --git-dir', { cwd: projectRoot });
		return true;
	} catch (error) {
		return false;
	}
}

/**
 * The commit HEAD points at, or null outside a repository or before the
 * first commit
 */
export async function getHeadCommit(
	projectRoot: string
): Promise<string | null> {
	try {
		const { stdout } = await execAsync('git rev-parse --verify --quiet HEAD', {
			cwd: projectRoot
		});
		return stdout.trim() || null;
	} catch {
		return null;
	}
}

/**
 * Get the current git branch name
 */
export async function getCurrentBranch(
	projectRoot: string
): Promise<string | null> {
	if (!projectRoot) {
		throw new Error('projectRoot is required for getCurrentBranch');
	}

	try {
		const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', {
			cwd: projectRoot
		});
		return stdout.trim();
	} catch (error) {
		return null;
	}
}

/** How long one `gh` call may run before it is killed */
const GH_TIMEOUT_MS = 60_000;

/**
 * Run `gh` with an argument array. A non-zero exit resolves with `error` set,
 * since `gh api` still prints the response then. A call still running after
 * `timeoutMs` is killed and rejects with a TaskGraphError that says what to do.
 */
export function runGh(
	args: string[],
	options: { cwd?: string; input?: string; timeoutMs?: number } = {}
): Promise<{ stdout: string; stderr: string; error: Error | null }> {
	const timeoutMs = options.timeoutMs ?? GH_TIMEOUT_MS;
	return new Promise((resolve, reject) => {
		let child: ChildProcess | undefined;
		// Not execFile's own timeout: it waits for the pipes to close, which a
		// process gh started can hold open long after gh is killed
		const timer = setTimeout(() => {
			child?.kill('SIGKILL');
			for (const stream of child?.stdio ?? []) stream?.destroy();
			reject(
				errorWithHint(
					ERROR_CODES.NETWORK_ERROR,
					`\`gh ${args.join(' ')}\` did not finish within ${formatTimeout(timeoutMs)} and was stopped`,
					'Check your network connection and that `gh auth status` finishes without asking for anything, then try again'
				)
			);
		}, timeoutMs);
		child = execFile(
			'gh',
			args,
			{ cwd: options.cwd, maxBuffer: 64 * 1024 * 1024 },
			(error, stdout, stderr) => {
				clearTimeout(timer);
				resolve({
					stdout: String(stdout ?? ''),
					stderr: String(stderr ?? (error ? error.message : '')),
					error
				});
			}
		);
		// gh can exit before reading a large body (EPIPE); its exit reaches the callback
		child.stdin?.on('error', () => {});
		child.stdin?.end(options.input);
	});
}

/**
 * Check if gh CLI is available and authenticated
 */
export async function isGhCliAvailable(projectRoot?: string): Promise<boolean> {
	const { error } = await runGh(['auth', 'status'], { cwd: projectRoot });
	return !error;
}

/**
 * Get GitHub repository information using gh CLI
 */
export async function getGitHubRepoInfo(
	projectRoot: string
): Promise<GitHubRepoInfo | null> {
	if (!projectRoot) {
		throw new Error('projectRoot is required for getGitHubRepoInfo');
	}

	const { stdout, error } = await runGh(
		['repo', 'view', '--json', 'name,owner,defaultBranchRef'],
		{ cwd: projectRoot }
	);
	if (error) return null;
	try {
		return JSON.parse(stdout) as GitHubRepoInfo;
	} catch {
		return null;
	}
}

/**
 * Sanitize branch name to be a valid tag name
 */
export function sanitizeBranchNameForTag(branchName: string): string {
	if (!branchName || typeof branchName !== 'string') {
		return 'unknown-branch';
	}

	// Replace invalid characters with hyphens and clean up
	return (
		branchName
			// Tag names allow only letters, digits, `_` and `-`
			.replace(/[^a-zA-Z0-9_-]/g, '-')
			.replace(/^-+|-+$/g, '') // Remove leading/trailing hyphens
			.replace(/-+/g, '-') // Collapse multiple hyphens
			.toLowerCase() // Convert to lowercase
			.substring(0, 50)
	); // Limit length
}

/**
 * Check if a branch name would create a valid tag name
 */
export function isValidBranchForTag(branchName: string): boolean {
	if (!branchName || typeof branchName !== 'string') {
		return false;
	}

	// Check if it's a reserved branch name that shouldn't become tags
	const reservedBranches = ['main', 'master', 'develop', 'dev', 'head'];
	if (reservedBranches.includes(branchName.toLowerCase())) {
		return false;
	}

	// Check if sanitized name would be meaningful
	const sanitized = sanitizeBranchNameForTag(branchName);
	return sanitized.length > 0 && sanitized !== 'unknown-branch';
}

/**
 * The signed-in GitHub user's login, lowercase, from `gh api user`; null when
 * gh is missing, signed out or doesn't answer within 10 seconds
 */
export async function getGitHubLogin(cwd?: string): Promise<string | null> {
	try {
		const { stdout, error } = await runGh(['api', 'user', '--jq', '.login'], {
			cwd,
			timeoutMs: 10_000
		});
		const login = stdout.trim().toLowerCase();
		return error || !login ? null : login;
	} catch {
		return null;
	}
}
