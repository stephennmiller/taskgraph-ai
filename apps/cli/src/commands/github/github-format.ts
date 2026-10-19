/**
 * @fileoverview Text output for the github command (presentation only)
 */

import type {
	GitHubStatus,
	PlanStep,
	PushPlan,
	PushResult,
	UnlinkResult
} from '@tm/core';
import chalk from 'chalk';
import { theme } from '../../ui/theme.js';

const ACTION_LABEL: Record<PlanStep['action'], (text: string) => string> = {
	create: chalk.green,
	update: chalk.yellow,
	skip: theme.muted,
	close: chalk.red
};

/** Counts of each planned action */
export function countSteps(plan: PushPlan): Record<PlanStep['action'], number> {
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
		lines.push(
			'',
			chalk.yellow(
				`${plan.orphans.length} open issue(s) have no local task (pass --close-orphans to close them):`
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

export function formatStatus(status: GitHubStatus): string {
	const gh = status.ghAvailable
		? chalk.green('available and signed in')
		: chalk.red('not available (install gh and run `gh auth login`)');
	return [
		chalk.bold('GitHub'),
		`  gh CLI:   ${gh}`,
		`  repo:     ${status.repo ?? theme.muted('not detected (use --repo owner/name)')}`,
		`  linked:   ${status.linkedTasks} task(s)`,
		`  unlinked: ${status.unlinkedTasks} task(s)`
	].join('\n');
}

export function formatUnlink(result: UnlinkResult): string {
	return [
		`Unlinked task ${result.taskId} [${result.tag}] from issue #${result.issueNumber} (${result.url}).`,
		theme.muted(
			'The issue was not changed. If it still carries its taskgraph marker, the next push will link it again.'
		)
	].join('\n');
}
