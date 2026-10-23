/**
 * @fileoverview TypeScript bridge for model management functions
 * Wraps the JavaScript functions with proper TypeScript types
 * Will remove once we move models.js and config-manager to new structure
 */

// @ts-ignore - JavaScript module without types
import * as configManagerJs from '../../../../scripts/modules/config-manager.js';
// @ts-ignore - JavaScript module without types
import * as modelsJs from '../../../../scripts/modules/task-manager/models.js';

// ========== Types ==========

interface ModelCost {
	input: number;
	output: number;
}

export interface ModelData {
	id: string;
	name?: string;
	provider?: string;
	swe_score?: number | null;
	cost_per_1m_tokens?: ModelCost | null;
	allowed_roles?: string[];
	max_tokens?: number;
	supported?: boolean;
}

interface ModelConfiguration {
	provider: string;
	modelId: string;
	sweScore: number | null;
	cost: ModelCost | null;
}

export interface ModelConfigurationResponse {
	success: boolean;
	data?: {
		activeModels: {
			main: ModelConfiguration;
			research: ModelConfiguration;
			fallback: ModelConfiguration | null;
		};
		message: string;
	};
	error?: {
		code: string;
		message: string;
	};
}

export interface SetModelResponse {
	success: boolean;
	data?: {
		role: string;
		provider: string;
		modelId: string;
		message: string;
	};
	error?: {
		code: string;
		message: string;
	};
}

export interface SetModelOptions {
	providerHint?: string;
	mcpLog?: {
		info: (...args: unknown[]) => void;
		warn: (...args: unknown[]) => void;
		error: (...args: unknown[]) => void;
	};
	projectRoot: string;
}

// ========== Wrapped Functions ==========

/**
 * Get the current model configuration
 */
export async function getModelConfiguration(
	options: SetModelOptions
): Promise<ModelConfigurationResponse> {
	return modelsJs.getModelConfiguration(
		options as any
	) as Promise<ModelConfigurationResponse>;
}

/**
 * Set a model for a specific role
 */
export async function setModel(
	role: 'main' | 'research' | 'fallback',
	modelId: string,
	options: SetModelOptions
): Promise<SetModelResponse> {
	return modelsJs.setModel(
		role,
		modelId,
		options as any
	) as Promise<SetModelResponse>;
}

/**
 * Get available models from config manager
 */
export function getAvailableModels(): ModelData[] {
	return configManagerJs.getAvailableModels() as ModelData[];
}
