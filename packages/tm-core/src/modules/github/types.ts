/**
 * @fileoverview Types for the one-way GitHub Issues push
 */

import type { Task, TaskStatus } from '../../common/types/index.js';

/** Link stored in `task.metadata.github`, keyed by (tag, id) */
export interface GitHubLink {
	repo: string;
	issueNumber: number;
	url: string;
	syncedAt: string;
	/** The task status at the last push or pull; the base a pull compares against */
	lastPushedStatus: TaskStatus;
	/** Hash of the issue content last written to GitHub */
	bodyHash: string;
	/**
	 * The issue was written by hand and imported; push never changes it, and
	 * pull reads only whether it is open or closed
	 */
	imported?: boolean;
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

type PlanAction = 'create' | 'update' | 'skip' | 'close';

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
	/** Push only this tag; defaults to the active tag */
	tag?: string;
	/** Push every tag. Cannot be combined with `tag` */
	allTags?: boolean;
	/**
	 * Push only these task ids (top-level tasks), as a list or a comma
	 * separated string; defaults to every task in scope
	 */
	taskIds?: string[] | string;
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

/**
 * apply: the issue changed, the task did not; set the task to the issue's status
 * sync: both sides already agree; only record that they are in sync
 * conflict: both changed to different statuses; the task is left alone
 * skip: nothing to do, see `reason`
 */
export type PullAction = 'apply' | 'sync' | 'conflict' | 'skip';

export interface PullStep {
	action: PullAction;
	tag: string;
	taskId: string;
	title: string;
	issueNumber?: number;
	/** The task's current status */
	from?: TaskStatus;
	/** The status the issue stands for */
	to?: TaskStatus;
	reason?: string;
}

export interface PullPlan {
	repo: string;
	steps: PullStep[];
}

export interface PullOptions {
	/** `owner/name`; defaults to the repo reported by `gh repo view` */
	repo?: string;
	/** Pull only this tag; defaults to the active tag */
	tag?: string;
	/** Pull every tag. Cannot be combined with `tag` */
	allTags?: boolean;
	/** Pull only these task ids (top-level tasks), as a list or comma separated */
	taskIds?: string[] | string;
	dryRun?: boolean;
}

export interface PullResult {
	dryRun: boolean;
	plan: PullPlan;
	applied: number;
	synced: number;
	conflicts: number;
	skipped: number;
}

export interface ImportOptions {
	/** `owner/name`; defaults to the repo reported by `gh repo view` */
	repo?: string;
	/** Tag the new tasks go in; defaults to the active tag */
	tag?: string;
	/** Import only open issues carrying this label */
	label?: string;
	dryRun?: boolean;
}

/**
 * create: a new task for the issue
 * link: an unlinked task titled `<title> (#<n>)` already stands for the issue
 */
export interface ImportStep {
	action: 'create' | 'link';
	issueNumber: number;
	/** The issue's title */
	title: string;
	url: string;
	/** The task's id; unknown for a create in a dry run */
	taskId?: string;
}

export interface ImportResult {
	dryRun: boolean;
	repo: string;
	tag: string;
	steps: ImportStep[];
	created: number;
	linked: number;
	/** Open issues already linked to a task, or written by push */
	skipped: number;
}

export interface GitHubStatus {
	ghAvailable: boolean;
	repo: string | null;
	linkedTasks: number;
	unlinkedTasks: number;
}

export interface UnlinkResult {
	tag: string;
	taskId: string;
	issueNumber: number;
	url: string;
}
