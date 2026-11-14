/**
 * @fileoverview Text output for the github command (presentation only).
 * `github status` prints one line per check, as `doctor` does, with the fix
 * under one that failed:
 *
 *   ✗ gh CLI  not available
 *     Install the GitHub CLI, then run gh auth login
 *   – Linked  0 of 3 tasks
 *
 *   ✓ gh CLI  signed in
 *   ✓ Repo    acme/app
 *   ✓ Linked  2 of 3 tasks
 */

import {
	type GitHubStatus,
	type ImportResult,
	type PlanStep,
	type PullPlan,
	type PullResult,
	type PullStep,
	type PushPlan,
	type PushResult,
	sanitizeForTerminal,
	type UnlinkResult
} from '@tm/core';
import chalk from 'chalk';
import { fit } from '../../ui/formatters/markdown-formatters.js';
import { terminalWidth } from '../../ui/layout/helpers.js';
import { theme, withCode } from '../../ui/theme.js';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const ACTION_LABEL: Record<PlanStep['action'], (text: string) => string> = {
	create: chalk.green,
	update: chalk.yellow,
	skip: theme.muted,
	close: chalk.red
};

/** Counts of each planned action */
function countSteps(plan: PushPlan): Record<PlanStep['action'], number> {
	const counts = { create: 0, update: 0, skip: 0, close: 0 };
	for (const step of plan.steps) counts[step.action]++;
	return counts;
}

/** True when the plan would change something on GitHub */
export function hasWrites(plan: PushPlan): boolean {
	const counts = countSteps(plan);
	return counts.create + counts.update + counts.close > 0;
}

function describeStep(step: PlanStep): string {
	const label = ACTION_LABEL[step.action](step.action.padEnd(6));
	const target = step.issueNumber ? ` -> #${step.issueNumber}` : '';
	const reason = step.reason ? theme.muted(` (${step.reason})`) : '';
	return `  ${label} [${step.tag}] ${step.taskId} ${step.title}${target}${reason}`;
}

export function formatPlan(plan: PushPlan): string {
	plan = sanitizeForTerminal(plan);
	const counts = countSteps(plan);
	const lines = [
		chalk.bold(`Plan for ${plan.repo}`),
		`  ${counts.create} to create, ${counts.update} to update, ${counts.skip} unchanged, ${counts.close} to close`
	];
	// Unchanged tasks are only counted, not listed
	for (const step of plan.steps.filter((s) => s.action !== 'skip')) {
		lines.push(describeStep(step));
	}
	if (plan.orphans.length > 0) {
		const orphans = plan.orphans.length;
		lines.push(
			'',
			chalk.yellow(
				`${plural(orphans, 'open issue')} ${orphans === 1 ? 'has' : 'have'} no local task (pass --close-orphans to close ${orphans === 1 ? 'it' : 'them'}):`
			)
		);
		for (const orphan of plan.orphans) {
			lines.push(`  #${orphan.issueNumber} ${orphan.title}`);
		}
	}
	return lines.join('\n');
}

export function formatResult(result: PushResult): string {
	const prefix = result.dryRun ? 'would be ' : '';
	return [
		chalk.bold(result.dryRun ? 'Dry run, nothing written' : 'Push complete'),
		`  ${prefix}created ${result.created}, ${prefix}updated ${result.updated}, unchanged ${result.skipped}, ${prefix}closed ${result.closed}`
	].join('\n');
}

const PULL_LABEL: Record<PullStep['action'], (text: string) => string> = {
	apply: chalk.green,
	sync: theme.muted,
	conflict: chalk.red,
	skip: theme.muted
};

function countPullSteps(plan: PullPlan): Record<PullStep['action'], number> {
	const counts = { apply: 0, sync: 0, conflict: 0, skip: 0 };
	for (const step of plan.steps) counts[step.action]++;
	return counts;
}

/** True when a pull would change something in tasks.json */
export function hasPullChanges(plan: PullPlan): boolean {
	const counts = countPullSteps(plan);
	return (
		counts.apply + counts.sync > 0 ||
		plan.steps.some((s) => s.assignTo !== undefined)
	);
}

/** True when a pull would change a task's status or assignee (worth asking about) */
export function hasTaskChanges(plan: PullPlan): boolean {
	return plan.steps.some(
		(s) => s.action === 'apply' || s.assignTo !== undefined
	);
}

function describePullStep(step: PullStep): string {
	const label = PULL_LABEL[step.action](step.action.padEnd(8));
	const changes: string[] = [];
	if (step.action === 'conflict') {
		changes.push(`local ${step.from}, GitHub ${step.to}`);
	} else if (step.action !== 'skip') {
		changes.push(`${step.from} -> ${step.to}`);
	}
	if (step.assignTo !== undefined) {
		changes.push(`assignee -> ${step.assignTo ?? 'nobody'}`);
	}
	if (step.githubAssignee !== undefined) {
		changes.push(
			`assignee: GitHub ${step.githubAssignee ?? 'nobody'}, local kept`
		);
	}
	const change = changes.join(', ');
	const target = step.issueNumber ? ` (#${step.issueNumber})` : '';
	return `  ${label} [${step.tag}] ${step.taskId} ${step.title}${target}  ${theme.muted(change)}`;
}

export function formatPullPlan(plan: PullPlan): string {
	plan = sanitizeForTerminal(plan);
	const counts = countPullSteps(plan);
	const lines = [
		chalk.bold(`Pull plan for ${plan.repo}`),
		`  ${counts.apply} to update, ${counts.sync} already in sync, ${plural(counts.conflict, 'conflict')}, ${counts.skip} unchanged or skipped`
	];
	// Skipped tasks are only counted, not listed, unless their assignee changes
	for (const step of plan.steps.filter(
		(s) =>
			s.action !== 'skip' ||
			s.assignTo !== undefined ||
			s.githubAssignee !== undefined
	)) {
		lines.push(describePullStep(step));
	}
	if (counts.conflict > 0) {
		lines.push(
			'',
			chalk.yellow(
				`${plural(counts.conflict, 'task')} changed on both sides and ${counts.conflict === 1 ? 'keeps its' : 'keep their'} local status`
			),
			theme.muted(
				withCode('Run `taskgraph github push` to overwrite GitHub with it')
			)
		);
	}
	return lines.join('\n');
}

export function formatPullResult(result: PullResult): string {
	const prefix = result.dryRun ? 'would be ' : '';
	return [
		chalk.bold(result.dryRun ? 'Dry run, nothing written' : 'Pull complete'),
		`  ${prefix}updated ${result.applied}, ${prefix}marked in sync ${result.synced}, conflicts ${result.conflicts}, skipped ${result.skipped}`,
		...(result.assigned > 0 ? [`  ${prefix}reassigned ${result.assigned}`] : [])
	].join('\n');
}

export function formatStatus(status: GitHubStatus): string {
	status = sanitizeForTerminal(status);
	const pass = chalk.green('✓');
	const fail = chalk.red('✗');
	const total = status.linkedTasks + status.unlinkedTasks;
	const rows: Array<
		[mark: string, label: string, value: string, fix?: string]
	> = [
		status.ghAvailable
			? [pass, 'gh CLI', 'signed in']
			: [
					fail,
					'gh CLI',
					'not available',
					'Install the GitHub CLI, then run `gh auth login`'
				]
	];
	if (status.repo) {
		rows.push([pass, 'Repo', status.repo]);
	} else if (status.ghAvailable) {
		// Without gh the repo was never looked for; the row above says what to fix
		rows.push([
			fail,
			'Repo',
			'not detected',
			'Pass `--repo owner/name`, or run this in a GitHub checkout'
		]);
	}
	rows.push([
		status.linkedTasks > 0 ? pass : theme.muted('–'),
		'Linked',
		`${status.linkedTasks} of ${plural(total, 'task')}`
	]);
	const width = Math.max(...rows.map(([, label]) => label.length));
	return rows
		.flatMap(([mark, label, value, fix]) => [
			`${mark} ${label.padEnd(width)}  ${value}`,
			...(fix ? [`  ${theme.muted(withCode(fix))}`] : [])
		])
		.join('\n');
}

export function formatUnlink(result: UnlinkResult): string {
	result = sanitizeForTerminal(result);
	return [
		`Unlinked task ${result.taskId} [${result.tag}] from issue #${result.issueNumber} (${result.url}).`,
		theme.muted(
			'The issue was not changed. If it still carries its taskgraph marker, the next push will link it again.'
		)
	].join('\n');
}

/**
 * ✓ Imported 2 issues from acme/app into tag master
 *   #40  12  Fix login
 *   #41   7  Ship it  linked
 * 1 new · 1 linked to an existing task · 5 already linked
 * Next: taskgraph github pull -y once issues close
 */
export function formatImport(
	result: ImportResult,
	width = terminalWidth()
): string {
	result = sanitizeForTerminal(result);
	const { steps, repo, tag, skipped } = result;
	const already = skipped > 0 ? `${skipped} already linked` : '';
	if (steps.length === 0) {
		return `No new issues to import from ${repo}${already ? theme.muted(` · ${already}`) : ''}`;
	}
	const head = result.dryRun
		? `Would import ${plural(steps.length, 'issue')} from ${repo} into tag ${tag} (dry run, nothing written)`
		: `${chalk.green('✓')} Imported ${plural(steps.length, 'issue')} from ${repo} into tag ${tag}`;
	const numWidth = Math.max(...steps.map((s) => `#${s.issueNumber}`.length));
	const idWidth = Math.max(...steps.map((s) => (s.taskId ?? '+').length));
	const rows = steps.map((step) => {
		const lead = `  ${`#${step.issueNumber}`.padEnd(numWidth)}  ${(step.taskId ?? '+').padStart(idWidth)}  `;
		const tail = step.action === 'link' ? '  linked' : '';
		const title = fit(
			step.title,
			Math.max(10, width - lead.length - tail.length)
		);
		return `${lead}${title}${theme.muted(tail)}`;
	});
	const facts = [
		result.created > 0 ? `${result.created} new` : '',
		result.linked > 0 ? `${result.linked} linked to an existing task` : '',
		already
	].filter(Boolean);
	return [
		head,
		...rows,
		theme.muted(facts.join(' · ')),
		result.dryRun
			? 'Next: taskgraph github import'
			: 'Next: taskgraph github pull -y once issues close'
	].join('\n');
}
