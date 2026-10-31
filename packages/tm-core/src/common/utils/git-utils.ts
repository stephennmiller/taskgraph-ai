/**
 * @fileoverview Git utilities for TaskGraph
 * Git integration utilities using raw git commands and gh CLI
 */

import { type ChildProcess, exec, execFile, execSync } from 'child_process';
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
 * Synchronous check if directory is in a git repository
 */
export function isGitRepositorySync(projectRoot: string): boolean {
	if (!projectRoot) {
		return false;
	}

	try {
		execSync('git rev-parse --git-dir', {
			cwd: projectRoot,
			stdio: 'ignore'
		});
		return true;
	} catch (error) {
		return false;
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

/**
 * Synchronous get current git branch name
 */
export function getCurrentBranchSync(projectRoot: string): string | null {
	if (!projectRoot) {
		return null;
	}

	try {
		const stdout = execSync('git rev-parse --abbrev-ref HEAD', {
			cwd: projectRoot,
			encoding: 'utf8'
		});
		return stdout.trim();
	} catch (error) {
		return null;
	}
}

/**
 * Get list of all local git branches
 */
export async function getLocalBranches(projectRoot: string): Promise<string[]> {
	if (!projectRoot) {
		throw new Error('projectRoot is required for getLocalBranches');
	}

	try {
		const { stdout } = await execAsync(
			'git branch --format="%(refname:short)"',
			{ cwd: projectRoot, maxBuffer: 10 * 1024 * 1024 }
		);
		return stdout
			.trim()
			.split('\n')
			.filter((branch) => branch.length > 0)
			.map((branch) => branch.trim());
	} catch (error) {
		return [];
	}
}

/**
 * Get list of all remote branches
 */
export async function getRemoteBranches(
	projectRoot: string
): Promise<string[]> {
	if (!projectRoot) {
		throw new Error('projectRoot is required for getRemoteBranches');
	}

	try {
		const { stdout } = await execAsync(
			'git branch -r --format="%(refname:short)"',
			{ cwd: projectRoot, maxBuffer: 10 * 1024 * 1024 }
		);
		const names = stdout
			.trim()
			.split('\n')
			.filter((branch) => branch.length > 0 && !branch.includes('HEAD'))
			.map((branch) => branch.replace(/^[^/]+\//, '').trim());
		return Array.from(new Set(names));
	} catch (error) {
		return [];
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
 * Get git repository root directory
 */
export async function getGitRepositoryRoot(
	projectRoot: string
): Promise<string | null> {
	if (!projectRoot) {
		throw new Error('projectRoot is required for getGitRepositoryRoot');
	}

	try {
		const { stdout } = await execAsync('git rev-parse --show-toplevel', {
			cwd: projectRoot
		});
		return stdout.trim();
	} catch (error) {
		return null;
	}
}

/**
 * Get the default branch name for the repository
 */
export async function getDefaultBranch(
	projectRoot: string
): Promise<string | null> {
	if (!projectRoot) {
		throw new Error('projectRoot is required for getDefaultBranch');
	}

	try {
		// Try to get from GitHub first (if gh CLI is available)
		if (await isGhCliAvailable(projectRoot)) {
			const repoInfo = await getGitHubRepoInfo(projectRoot);
			if (repoInfo && repoInfo.defaultBranchRef) {
				return repoInfo.defaultBranchRef.name;
			}
		}

		// Fallback to git remote info (support non-origin remotes)
		const remotesRaw = await execAsync('git remote', { cwd: projectRoot });
		const remotes = remotesRaw.stdout.trim().split('\n').filter(Boolean);
		if (remotes.length > 0) {
			const primary = remotes.includes('origin') ? 'origin' : remotes[0];
			// Parse `git remote show` (preferred)
			try {
				const { stdout } = await execAsync(`git remote show ${primary}`, {
					cwd: projectRoot,
					maxBuffer: 10 * 1024 * 1024
				});
				const m = stdout.match(/HEAD branch:\s+([^\s]+)/);
				if (m) return m[1].trim();
			} catch {}
			// Fallback to symbolic-ref of remote HEAD
			try {
				const { stdout } = await execAsync(
					`git symbolic-ref refs/remotes/${primary}/HEAD`,
					{ cwd: projectRoot }
				);
				return stdout.replace(`refs/remotes/${primary}/`, '').trim();
			} catch {}
		}
		// If we couldn't determine, throw to trigger final fallbacks
		throw new Error('default-branch-not-found');
	} catch (error) {
		// Final fallback - common default branch names
		const commonDefaults = ['main', 'master'];
		const branches = await getLocalBranches(projectRoot);
		const remoteBranches = await getRemoteBranches(projectRoot);

		for (const defaultName of commonDefaults) {
			if (
				branches.includes(defaultName) ||
				remoteBranches.includes(defaultName)
			) {
				return defaultName;
			}
		}

		return null;
	}
}

/**
 * Check if we're currently on the default branch
 */
export async function isOnDefaultBranch(projectRoot: string): Promise<boolean> {
	if (!projectRoot) {
		throw new Error('projectRoot is required for isOnDefaultBranch');
	}

	try {
		const [currentBranch, defaultBranch] = await Promise.all([
			getCurrentBranch(projectRoot),
			getDefaultBranch(projectRoot)
		]);
		return (
			currentBranch !== null &&
			defaultBranch !== null &&
			currentBranch === defaultBranch
		);
	} catch (error) {
		return false;
	}
}

/**
 * Check if the current working directory is inside a Git work-tree
 */
export function insideGitWorkTree(): boolean {
	try {
		execSync('git rev-parse --is-inside-work-tree', {
			stdio: 'ignore',
			cwd: process.cwd()
		});
		return true;
	} catch {
		return false;
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
