/**
 * @fileoverview What `taskgraph models` shows and confirms, e.g.
 *
 *   Models
 *     Main      sonnet  creates and updates tasks
 *     Research  opus    research and --research runs
 *     Fallback  haiku   used if the main model fails
 *
 *   Choices: opus (most capable), sonnet (balanced), haiku (fastest)
 *   Change them with taskgraph models --setup
 *
 * and, after a change,
 *
 *   ✓ Main model  sonnet → opus
 *
 * It replaces two tables wider than 80 columns (a provider column that
 * always said claude-code, SWE scores, and a cost column that always said
 * Free) and a four-step "Next Steps" box.
 */

import chalk from 'chalk';
import { theme } from '../theme.js';

export type ModelRoleName = 'main' | 'research' | 'fallback';

export const MODEL_ROLE_ORDER: ModelRoleName[] = [
	'main',
	'research',
	'fallback'
];

/** How each role is named and what it's for */
export const MODEL_ROLES: Record<
	ModelRoleName,
	{ label: string; purpose: string }
> = {
	main: { label: 'Main', purpose: 'creates and updates tasks' },
	research: { label: 'Research', purpose: 'research and --research runs' },
	fallback: { label: 'Fallback', purpose: 'used if the main model fails' }
};

/** One phrase per Claude Code model, so a choice doesn't need a benchmark */
export const MODEL_NOTES: Record<string, string> = {
	opus: 'most capable',
	sonnet: 'balanced',
	haiku: 'fastest'
};

/** The model set for each role; null when a role has none */
export type ModelAssignments = Record<ModelRoleName, string | null>;

/** One role's model before and after a change */
export interface ModelChange {
	role: ModelRoleName;
	from: string | null;
	to: string;
}

const withCode = (text: string) =>
	text.replace(/`([^`]+)`/g, (_, code: string) => theme.brand(code));

/** `opus (most capable), sonnet (balanced), haiku (fastest)` */
export function formatModelChoices(modelIds: string[]): string {
	return modelIds
		.map((id) => (MODEL_NOTES[id] ? `${id} (${MODEL_NOTES[id]})` : id))
		.join(', ');
}

/**
 * Format the models set for each role, the models to choose from, and how
 * to change them.
 *
 * @param models - The model set for each role
 * @param available - Every model ID the roles can use, in display order
 */
export function formatModelConfiguration(
	models: ModelAssignments,
	available: string[]
): string {
	const labelWidth = Math.max(
		...MODEL_ROLE_ORDER.map((role) => MODEL_ROLES[role].label.length)
	);
	const modelWidth = Math.max(
		'none'.length,
		...MODEL_ROLE_ORDER.map((role) => models[role]?.length ?? 0)
	);

	const lines = [theme.heading('Models')];
	for (const role of MODEL_ROLE_ORDER) {
		const { label, purpose } = MODEL_ROLES[role];
		const model = models[role];
		const value = model
			? theme.brand(model.padEnd(modelWidth))
			: theme.muted('none'.padEnd(modelWidth));
		lines.push(
			`  ${label.padEnd(labelWidth)}  ${value}  ${theme.muted(purpose)}`
		);
	}

	lines.push('');
	if (available.length > 0) {
		lines.push(theme.muted(`Choices: ${formatModelChoices(available)}`));
	}
	lines.push(
		theme.muted(withCode('Change them with `taskgraph models --setup`'))
	);
	return lines.join('\n');
}

const transition = (change: ModelChange) =>
	change.from === change.to
		? `${theme.brand(change.to)} ${theme.muted('(unchanged)')}`
		: change.from
			? `${change.from} → ${theme.brand(change.to)}`
			: theme.brand(change.to);

/**
 * Format the result of setting one or more models, like set-status does.
 *
 * @param changes - The roles that were set, in order
 */
export function formatModelChanges(changes: ModelChange[]): string {
	const check = chalk.green('✓');
	if (changes.length === 1) {
		const [change] = changes;
		return `${check} ${MODEL_ROLES[change.role].label} model  ${transition(change)}`;
	}

	const labelWidth = Math.max(
		...changes.map((change) => MODEL_ROLES[change.role].label.length)
	);
	const changed = changes.filter((change) => change.from !== change.to);
	const header =
		changed.length === 0
			? `${check} Models unchanged`
			: `${check} Updated ${changed.length} ${changed.length === 1 ? 'model' : 'models'}`;
	return [
		header,
		...changes.map(
			(change) =>
				`  ${MODEL_ROLES[change.role].label.padEnd(labelWidth)}  ${transition(change)}`
		)
	].join('\n');
}
