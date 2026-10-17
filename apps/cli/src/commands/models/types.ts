/**
 * @fileoverview Type definitions for model setup functionality
 */

/**
 * Represents a model role in the system
 */
export type ModelRole = 'main' | 'research' | 'fallback';

/**
 * Special control values for model selection
 */
export const CONTROL_VALUES = {
	CANCEL: '__CANCEL__',
	NO_CHANGE: '__NO_CHANGE__'
} as const;

/**
 * Model information for display
 */
export interface ModelInfo {
	id: string;
	name?: string;
	provider: string;
	cost_per_1m_tokens?: {
		input: number;
		output: number;
	};
	allowed_roles: ModelRole[];
}

/**
 * Currently configured model for a role
 */
export interface CurrentModel {
	modelId?: string;
	provider?: string;
}

/**
 * Current models configuration
 */
export interface CurrentModels {
	main: CurrentModel | null;
	research: CurrentModel | null;
	fallback: CurrentModel | null;
}

/**
 * Model selection choice for inquirer prompts
 */
export interface ModelChoice {
	name: string;
	value: { id: string; provider: string } | string | null;
	short?: string;
	type?: 'separator';
}

/**
 * Prompt data for a specific role
 */
export interface PromptData {
	choices: (ModelChoice | any)[]; // any to accommodate Separator instances
	default: number;
}
