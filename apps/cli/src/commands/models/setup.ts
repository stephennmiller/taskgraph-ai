/**
 * @fileoverview `taskgraph models --setup`: pick a model for each role
 *
 *   ✔ Main model (creates and updates tasks) opus
 *   ✔ Research model (research and --research runs) sonnet
 *   ✔ Fallback model (used if the main model fails) sonnet
 *
 *   ✓ Main model  sonnet → opus
 *
 * Nothing is saved until all three are answered, so Ctrl-C part way through
 * changes nothing.
 */

import {
	getAvailableModels,
	getModelConfiguration,
	setModel
} from '../../lib/model-management.js';
import {
	MODEL_ROLE_ORDER,
	type ModelAssignments,
	type ModelChange,
	formatModelChanges
} from '../../ui/formatters/model-formatters.js';
import { theme } from '../../ui/theme.js';
import { printError } from '../../utils/error-handler.js';
import { buildModelChoices, promptForModel } from './prompts.js';
import type { ModelInfo } from './types.js';

/** Inquirer throws this when the user presses Ctrl-C */
const isPromptExit = (error: unknown) =>
	error instanceof Error && error.name === 'ExitPromptError';

async function currentModels(projectRoot: string): Promise<ModelAssignments> {
	const result = await getModelConfiguration({ projectRoot });
	const active = result.success ? result.data?.activeModels : undefined;
	return {
		main: active?.main?.modelId ?? null,
		research: active?.research?.modelId ?? null,
		fallback: active?.fallback?.modelId ?? null
	};
}

/**
 * Save the roles whose model changed, one at a time.
 *
 * @returns The changes that were saved, and whether every save worked
 */
async function saveChanges(
	changes: ModelChange[],
	projectRoot: string
): Promise<{ saved: ModelChange[]; ok: boolean }> {
	const saved: ModelChange[] = [];
	for (const change of changes) {
		const result = await setModel(change.role, change.to, { projectRoot });
		if (!result.success) {
			printError(
				`Couldn't set the ${change.role} model: ${result.error?.message ?? 'unknown error'}`
			);
			return { saved, ok: false };
		}
		saved.push(change);
	}
	return { saved, ok: true };
}

/**
 * Ask for a model for each role and save the ones that changed.
 *
 * @returns false if the user cancelled or a model couldn't be saved
 */
export async function runInteractiveSetup(
	projectRoot: string
): Promise<boolean> {
	const current = await currentModels(projectRoot);
	const models = (getAvailableModels() as ModelInfo[]).filter(
		(model) => model.allowed_roles
	);

	const chosen: Partial<ModelAssignments> = {};
	try {
		for (const role of MODEL_ROLE_ORDER) {
			const choices = buildModelChoices(role, models, current[role]);
			chosen[role] = await promptForModel(role, choices, current[role]);
		}
	} catch (error) {
		if (!isPromptExit(error)) throw error;
		console.log(theme.muted('\nCancelled; no models changed'));
		process.exitCode = 130;
		return false;
	}

	const changes: ModelChange[] = MODEL_ROLE_ORDER.filter(
		(role) => chosen[role] && chosen[role] !== current[role]
	).map((role) => ({
		role,
		from: current[role],
		to: chosen[role] as string
	}));

	// The answer lines already show what each role uses
	if (changes.length === 0) return true;

	const { saved, ok } = await saveChanges(changes, projectRoot);
	if (saved.length > 0) {
		console.log(`\n${formatModelChanges(saved)}`);
	}
	if (!ok) process.exitCode = 1;
	return ok;
}
