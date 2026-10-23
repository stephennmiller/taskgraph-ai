/**
 * @fileoverview Pure GitHub issue -> task status mapping (the inverse of what
 * issue-renderer.ts writes)
 */

import type { TaskStatus } from '../../../common/types/index.js';
import { normalizeTaskStatus } from '../../tasks/utils/legacy-status.js';
import type { RemoteIssue } from '../types.js';

const STATUS_LABEL_PREFIX = 'taskgraph:status/';

/** Statuses the renderer puts on an open issue as a label */
const OPEN_STATUSES: readonly TaskStatus[] = [
	'pending',
	'in-progress',
	'deferred',
	'blocked',
	'review'
];

/**
 * Whether two statuses match. A link's lastPushedStatus is stored as pushed,
 * so one saved by an older version can hold an older spelling.
 */
export function sameStatus(a: TaskStatus, b: TaskStatus): boolean {
	return normalizeTaskStatus(a) === normalizeTaskStatus(b);
}

/**
 * The task status an issue stands for. A closed issue is done (or cancelled
 * when closed as not planned) whatever its labels say. An open issue takes its
 * status label; with none, someone reopened it, so it is pending. When several
 * status labels are present, the one that differs from `base` wins, because
 * that is the one a person added.
 */
export function statusFromIssue(
	issue: RemoteIssue,
	base?: TaskStatus
): TaskStatus {
	if (issue.state === 'closed') {
		return issue.stateReason === 'not_planned' ? 'cancelled' : 'done';
	}
	const fromLabels = issue.labels
		.filter((label) => label.startsWith(STATUS_LABEL_PREFIX))
		.map((label) => label.slice(STATUS_LABEL_PREFIX.length))
		.filter((status): status is TaskStatus =>
			OPEN_STATUSES.includes(status as TaskStatus)
		);
	if (fromLabels.length === 0) return 'pending';
	if (fromLabels.length > 1 && base) {
		const added = fromLabels.find((status) => !sameStatus(status, base));
		if (added) return added;
	}
	return fromLabels[0];
}
