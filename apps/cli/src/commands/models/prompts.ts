/**
 * @fileoverview The model prompts in `taskgraph models --setup`
 *
 * There are three Claude Code models, so each role is a plain list with the
 * current model selected, rather than a search box with "No change" and
 * "Cancel" entries above the models. Enter keeps the current model and
 * Ctrl-C cancels, as in any other prompt.
 */

import inquirer from 'inquirer';
import {
	MODEL_NOTES,
	MODEL_ROLES,
	type ModelRoleName
} from '../../ui/formatters/model-formatters.js';
import { theme } from '../../ui/theme.js';
import type { ModelInfo } from './types.js';

export interface ModelChoice {
	name: string;
	value: string;
	short: string;
}

/**
 * The models a role can use, one line each:
 *
 *   opus    most capable
 *   sonnet  balanced · current
 *   haiku   fastest
 */
export function buildModelChoices(
	role: ModelRoleName,
	models: ModelInfo[],
	currentModelId: string | null
): ModelChoice[] {
	const usable = models.filter((model) => model.allowed_roles.includes(role));
	const width = Math.max(0, ...usable.map((model) => model.id.length));
	return usable.map((model) => {
		const note = [
			MODEL_NOTES[model.id],
			model.id === currentModelId ? 'current' : undefined
		]
			.filter(Boolean)
			.join(' · ');
		return {
			name: note ? `${model.id.padEnd(width)}  ${theme.muted(note)}` : model.id,
			value: model.id,
			short: model.id
		};
	});
}

/** `Main model (creates and updates tasks)` */
export function modelPromptMessage(role: ModelRoleName): string {
	const { label, purpose } = MODEL_ROLES[role];
	return `${label} model (${purpose})`;
}

/**
 * Ask which model a role should use. Starts on the current model, so Enter
 * keeps it.
 */
export async function promptForModel(
	role: ModelRoleName,
	choices: ModelChoice[],
	currentModelId: string | null
): Promise<string> {
	const { model } = await inquirer.prompt<{ model: string }>([
		{
			type: 'select',
			name: 'model',
			message: modelPromptMessage(role),
			choices,
			default: currentModelId ?? undefined
		}
	]);
	return model;
}
