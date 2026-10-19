/**
 * @fileoverview The GitHub operations the push needs. Implemented by the
 * `gh` CLI client; tests use an in-memory one.
 */

import type {
	IssueState,
	IssueStateReason,
	RemoteIssue,
	RepoInfo
} from '../types.js';

export interface CreateIssueInput {
	title: string;
	body: string;
	labels: string[];
}

export interface UpdateIssueInput extends Partial<CreateIssueInput> {
	state?: IssueState;
	stateReason?: IssueStateReason;
}

export interface GitHubClient {
	getRepo(): Promise<RepoInfo>;
	/** All issues (open and closed) carrying the label */
	listIssues(label: string): Promise<RemoteIssue[]>;
	createIssue(input: CreateIssueInput): Promise<RemoteIssue>;
	updateIssue(number: number, input: UpdateIssueInput): Promise<RemoteIssue>;
	/** Create any of the labels that do not exist yet */
	ensureLabels(labels: string[]): Promise<void>;
}
