/**
 * @fileoverview Types for the one-way GitHub Issues push
 */

import type { Task } from '../../common/types/index.js';

/** Link stored in `task.metadata.github`, keyed by (tag, id) */
export interface GitHubLink {
	repo: string;
	issueNumber: number;
	url: string;
	syncedAt: string;
	lastPushedStatus: string;
	/** Hash of the issue content last written to GitHub */
	bodyHash: string;
}

export type IssueState = 'open' | 'closed';
export type IssueStateReason = 'completed' | 'not_planned';

/** What a task looks like as a GitHub issue */
export interface RenderedIssue {
	title: string;
	body: string;
	labels: string[];
	state: IssueState;
	stateReason?: IssueStateReason;
}

/** An issue as read back from GitHub */
export interface RemoteIssue {
	number: number;
	url: string;
	title: string;
	body: string;
	labels: string[];
	state: IssueState;
	stateReason?: IssueStateReason;
}

export interface RepoInfo {
	fullName: string;
	url: string;
}

/** A local task together with the tag it lives in */
export interface SyncTask {
	tag: string;
	task: Task;
}

export type PlanAction = 'create' | 'update' | 'skip' | 'close';

export interface PlanStep {
	action: PlanAction;
	tag: string;
	taskId: string;
	title: string;
	issueNumber?: number;
	/** The link was rebuilt from the hidden marker, not from metadata */
	recovered?: boolean;
	/** Issue URL, known when the issue already exists */
	url?: string;
	reason?: string;
}

/** An open issue that no local task claims any more */
export interface OrphanIssue {
	issueNumber: number;
	url: string;
	title: string;
	tag?: string;
	taskId?: string;
}

export interface PushPlan {
	repo: string;
	steps: PlanStep[];
	orphans: OrphanIssue[];
}

export interface PushOptions {
	/** `owner/name`; defaults to the repo reported by `gh repo view` */
	repo?: string;
	/** Push only this tag; defaults to every tag */
	tag?: string;
	includeDetails?: boolean;
	closeOrphans?: boolean;
	dryRun?: boolean;
	/** Pause between writes in ms (default 400) */
	delayMs?: number;
}

export interface PushResult {
	dryRun: boolean;
	plan: PushPlan;
	created: number;
	updated: number;
	skipped: number;
	closed: number;
	orphans: OrphanIssue[];
}

export interface GitHubStatus {
	ghAvailable: boolean;
	repo: string | null;
	linkedTasks: number;
	unlinkedTasks: number;
}
