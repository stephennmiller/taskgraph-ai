/**
 * @fileoverview Pure task -> GitHub issue rendering
 */

import { createHash } from 'node:crypto';
import type { Task } from '../../../common/types/index.js';
import type { RenderedIssue } from '../types.js';

export const BASE_LABEL = 'taskgraph';
/** Only the first line counts: that is where renderIssue writes the marker */
const MARKER_PATTERN = /^<!-- taskgraph:v1 tag=(\S*) id=(\S*) -->(?:\r?\n|$)/;

export interface RenderContext {
	tag: string;
	includeDetails?: boolean;
	/** Issue numbers of already-synced tasks in this tag, by task id */
	issueNumbers?: ReadonlyMap<string, number>;
}

export function markerFor(tag: string, id: string): string {
	return `<!-- taskgraph:v1 tag=${encodeURIComponent(tag)} id=${encodeURIComponent(id)} -->`;
}

export function parseMarker(body: string): { tag: string; id: string } | null {
	const match = MARKER_PATTERN.exec(body ?? '');
	if (!match) return null;
	try {
		return {
			tag: decodeURIComponent(match[1]),
			id: decodeURIComponent(match[2])
		};
	} catch {
		return null;
	}
}

/** Labels are capped at 50 characters by GitHub */
function label(name: string): string {
	return `${BASE_LABEL}:${name}`.slice(0, 50);
}

function stateFor(
	status: string
): Pick<RenderedIssue, 'state' | 'stateReason'> {
	if (status === 'done') return { state: 'closed', stateReason: 'completed' };
	if (status === 'cancelled')
		return { state: 'closed', stateReason: 'not_planned' };
	return { state: 'open' };
}

export function renderIssue(task: Task, ctx: RenderContext): RenderedIssue {
	const id = String(task.id);
	const state = stateFor(task.status);
	const labels = [BASE_LABEL];
	if (task.priority) labels.push(label(`priority/${task.priority}`));
	if (state.state === 'open') labels.push(label(`status/${task.status}`));
	labels.push(label(`tag/${ctx.tag}`));

	const sections: string[] = [markerFor(ctx.tag, id)];
	if (task.description) sections.push(task.description);

	const blockers = (task.dependencies ?? [])
		.map((dep) => ctx.issueNumbers?.get(String(dep)))
		.filter((n): n is number => n !== undefined)
		.map((n) => `Blocked by #${n}`);
	if (blockers.length) sections.push(blockers.join('\n'));

	if (task.subtasks?.length) {
		const items = task.subtasks.map((st) => {
			const mark = st.status === 'done' ? 'x' : ' ';
			return `- [${mark}] ${id}.${st.id} ${st.title}`;
		});
		sections.push(`### Subtasks\n${items.join('\n')}`);
	}

	if (ctx.includeDetails) {
		if (task.details) sections.push(`### Details\n${task.details}`);
		if (task.testStrategy)
			sections.push(`### Test strategy\n${task.testStrategy}`);
	}

	return {
		title: `[${id}] ${task.title}`,
		body: sections.join('\n\n'),
		labels: labels.sort(),
		...state
	};
}

/** Hash of everything written to GitHub, used to skip unchanged issues */
export function hashIssue(issue: RenderedIssue): string {
	const canonical = JSON.stringify([
		issue.title,
		issue.body,
		[...issue.labels].sort(),
		issue.state,
		issue.stateReason ?? null
	]);
	return createHash('sha256').update(canonical).digest('hex');
}
