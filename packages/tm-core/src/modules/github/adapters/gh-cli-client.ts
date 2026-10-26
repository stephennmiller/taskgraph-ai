/**
 * @fileoverview GitHubClient backed by `gh api`.
 *
 * Every call goes through execFile with an argument array. Request bodies are
 * written to stdin (`--input -`), never put on the command line, so titles and
 * bodies can contain any characters without shell interpretation.
 */

import { execFile } from 'node:child_process';
import {
	ERROR_CODES,
	TaskGraphError
} from '../../../common/errors/taskgraph-error.js';
import type { RemoteIssue, RepoInfo } from '../types.js';
import type {
	CreateIssueInput,
	GitHubClient,
	UpdateIssueInput
} from './github-client.interface.js';

/**
 * GitHub `owner/name`.
 *
 * An owner has no dots, so it cannot be `.` or `..`. Underscores and loose
 * hyphens stay allowed: Enterprise Managed User logins end in `_shortcode`,
 * and some older logins break today's hyphen rules.
 * A repository name is 1-100 characters from `[A-Za-z0-9._-]`, is not
 * only dots, and does not end in `.git`.
 */
const OWNER_PATTERN = /^[A-Za-z0-9_-]+$/;
const NAME_PATTERN = /^(?!\.+$)(?!.*\.git$)[A-Za-z0-9._-]{1,100}$/i;

function isGitHubRepo(repo: string): boolean {
	const slash = repo.indexOf('/');
	if (slash < 1 || repo.includes('/', slash + 1)) return false;
	return (
		OWNER_PATTERN.test(repo.slice(0, slash)) &&
		NAME_PATTERN.test(repo.slice(slash + 1))
	);
}

const PAGE_SIZE = 100;
const MAX_RETRIES = 3;
const MAX_WAIT_MS = 120_000;
const LABEL_COLOR = '5319e7';

export interface GhCliClientOptions {
	cwd?: string;
	/** Injectable for tests */
	sleep?: (ms: number) => Promise<void>;
}

interface GhResponse {
	status: number;
	headers: Record<string, string>;
	data: any;
}

interface RawIssue {
	number: number;
	html_url: string;
	title: string;
	body: string | null;
	labels: Array<{ name: string } | string>;
	state: 'open' | 'closed';
	state_reason?: 'completed' | 'not_planned' | 'reopened' | null;
	pull_request?: unknown;
}

const defaultSleep = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

function toRemoteIssue(raw: RawIssue): RemoteIssue {
	return {
		number: raw.number,
		url: raw.html_url,
		title: raw.title,
		body: raw.body ?? '',
		labels: raw.labels.map((l) => (typeof l === 'string' ? l : l.name)),
		state: raw.state,
		stateReason:
			raw.state_reason === 'completed' || raw.state_reason === 'not_planned'
				? raw.state_reason
				: undefined
	};
}

/** Split `gh api -i` output into status, headers and JSON body */
function parseResponse(stdout: string): GhResponse {
	let rest = stdout;
	let status = 0;
	let headers: Record<string, string> = {};
	// A redirect can put several header blocks in front of the body
	while (rest.startsWith('HTTP/')) {
		const split = rest.search(/\r?\n\r?\n/);
		const head = split === -1 ? rest : rest.slice(0, split);
		const [statusLine, ...headerLines] = head.split(/\r?\n/);
		status = Number(statusLine.split(' ')[1]);
		headers = {};
		for (const line of headerLines) {
			const idx = line.indexOf(':');
			if (idx > 0) {
				headers[line.slice(0, idx).trim().toLowerCase()] = line
					.slice(idx + 1)
					.trim();
			}
		}
		rest = split === -1 ? '' : rest.slice(split).replace(/^\r?\n\r?\n/, '');
	}
	let data: any = null;
	if (rest.trim()) {
		try {
			data = JSON.parse(rest);
		} catch {
			data = rest;
		}
	}
	return { status, headers, data };
}

export class GhCliClient implements GitHubClient {
	private readonly sleep: (ms: number) => Promise<void>;

	constructor(
		private readonly repo: string,
		private readonly options: GhCliClientOptions = {}
	) {
		if (!isGitHubRepo(repo)) {
			throw new TaskGraphError(
				`Invalid repository "${repo}", expected owner/name`,
				ERROR_CODES.INVALID_INPUT
			);
		}
		this.sleep = options.sleep ?? defaultSleep;
	}

	async getRepo(): Promise<RepoInfo> {
		const { data } = await this.request('GET', `repos/${this.repo}`);
		return { fullName: data.full_name, url: data.html_url };
	}

	async listIssues(
		label?: string,
		state: 'open' | 'all' = 'all'
	): Promise<RemoteIssue[]> {
		const issues: RemoteIssue[] = [];
		const filter = label ? `labels=${encodeURIComponent(label)}&` : '';
		for (let page = 1; ; page++) {
			const query = `${filter}state=${state}&per_page=${PAGE_SIZE}&page=${page}`;
			const { data } = await this.request(
				'GET',
				`repos/${this.repo}/issues?${query}`
			);
			const batch = data as RawIssue[];
			issues.push(...batch.filter((i) => !i.pull_request).map(toRemoteIssue));
			if (batch.length < PAGE_SIZE) return issues;
		}
	}

	async createIssue(input: CreateIssueInput): Promise<RemoteIssue> {
		const { data } = await this.request(
			'POST',
			`repos/${this.repo}/issues`,
			input
		);
		return toRemoteIssue(data);
	}

	async updateIssue(
		number: number,
		input: UpdateIssueInput
	): Promise<RemoteIssue> {
		const { stateReason, ...rest } = input;
		const body = stateReason ? { ...rest, state_reason: stateReason } : rest;
		const { data } = await this.request(
			'PATCH',
			`repos/${this.repo}/issues/${number}`,
			body
		);
		return toRemoteIssue(data);
	}

	async ensureLabels(labels: string[]): Promise<void> {
		const existing = new Set<string>();
		for (let page = 1; ; page++) {
			const { data } = await this.request(
				'GET',
				`repos/${this.repo}/labels?per_page=${PAGE_SIZE}&page=${page}`
			);
			for (const l of data as Array<{ name: string }>) {
				existing.add(l.name.toLowerCase());
			}
			if ((data as unknown[]).length < PAGE_SIZE) break;
		}
		for (const name of new Set(labels)) {
			if (existing.has(name.toLowerCase())) continue;
			await this.request('POST', `repos/${this.repo}/labels`, {
				name,
				color: LABEL_COLOR
			});
		}
	}

	private async request(
		method: string,
		path: string,
		body?: unknown
	): Promise<GhResponse> {
		const args = ['api', '-i', '-X', method, path];
		if (body !== undefined) args.push('--input', '-');
		const input = body === undefined ? undefined : JSON.stringify(body);

		for (let attempt = 0; ; attempt++) {
			const { stdout, stderr } = await this.run(args, input);
			const response = parseResponse(stdout);
			if (response.status > 0 && response.status < 400) return response;

			const retryAfter = Number(response.headers['retry-after']);
			const rateLimited = response.status === 403 || response.status === 429;
			if (rateLimited && retryAfter > 0 && attempt < MAX_RETRIES) {
				await this.sleep(Math.min(retryAfter * 1000, MAX_WAIT_MS));
				continue;
			}

			const message =
				(response.data && response.data.message) ||
				stderr.trim() ||
				'gh failed';
			throw new TaskGraphError(
				`GitHub request ${method} ${path} failed (${response.status || 'no response'}): ${message}`,
				ERROR_CODES.API_ERROR,
				{ operation: 'gh-api', resource: path }
			);
		}
	}

	private run(
		args: string[],
		input?: string
	): Promise<{ stdout: string; stderr: string }> {
		return new Promise((resolve) => {
			// gh exits non-zero on 4xx/5xx but still prints the response, so
			// errors resolve with whatever was captured and the caller inspects it
			const child = execFile(
				'gh',
				args,
				{ cwd: this.options.cwd, maxBuffer: 64 * 1024 * 1024 },
				(error, stdout, stderr) => {
					resolve({
						stdout: String(stdout ?? ''),
						stderr: String(stderr ?? (error ? error.message : ''))
					});
				}
			);
			child.stdin?.end(input);
		});
	}
}
