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
	/** Logins to assign to the new issue */
	assignees?: string[];
}

export interface UpdateIssueInput
	extends Partial<Omit<CreateIssueInput, 'assignees'>> {
	state?: IssueState;
	stateReason?: IssueStateReason;
}

export interface GitHubClient {
	getRepo(): Promise<RepoInfo>;
	/** Issues carrying the label (any label when omitted), open and closed by default */
	listIssues(label?: string, state?: 'open' | 'all'): Promise<RemoteIssue[]>;
	createIssue(input: CreateIssueInput): Promise<RemoteIssue>;
	updateIssue(number: number, input: UpdateIssueInput): Promise<RemoteIssue>;
	/** Add or remove these assignees, leaving the issue's others alone */
	changeAssignees(
		number: number,
		change: 'add' | 'remove',
		logins: string[]
	): Promise<RemoteIssue>;
	/** Create any of the labels that do not exist yet */
	ensureLabels(labels: string[]): Promise<void>;
}
