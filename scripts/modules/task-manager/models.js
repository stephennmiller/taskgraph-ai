/**
 * models.js
 * Core functionality for managing AI model configurations.
 * Claude Code is the only provider, so models are the Claude Code aliases
 * listed in supported-models.json.
 */

import { CUSTOM_PROVIDERS } from '@tm/core';
import { findConfigPath } from '../../../src/utils/path-utils.js';
import {
	getAvailableModels,
	getConfig,
	getFallbackModelId,
	getFallbackProvider,
	getMainModelId,
	getMainProvider,
	getResearchModelId,
	getResearchProvider,
	isConfigFilePresent,
	writeConfig
} from '../config-manager.js';
import { log } from '../utils.js';

// Constants
const CONFIG_MISSING_ERROR =
	'The configuration file is missing. Run "taskgraph init" to create it.';
const ROLES = ['main', 'research', 'fallback'];

/**
 * Throws unless the project has a configuration file.
 * @param {string} projectRoot - Project root directory
 */
function assertConfigPresent(projectRoot) {
	if (!projectRoot) {
		throw new Error('Project root is required but not found.');
	}

	const configPath = findConfigPath(null, { projectRoot });
	const configExists = isConfigFilePresent(projectRoot);

	log(
		'debug',
		`Checking for config file using findConfigPath, found: ${configPath}`
	);
	log(
		'debug',
		`Checking config file using isConfigFilePresent(), exists: ${configExists}`
	);

	if (!configExists) {
		throw new Error(CONFIG_MISSING_ERROR);
	}
}

/**
 * Builds the reporter used for MCP logging.
 * @param {Object} [mcpLog] - MCP logger object
 * @returns {Function} report(level, ...args)
 */
function createReporter(mcpLog) {
	return (level, ...args) => {
		if (mcpLog && typeof mcpLog[level] === 'function') {
			mcpLog[level](...args);
		}
	};
}

/**
 * Get the current model configuration
 * @param {Object} [options] - Options for the operation
 * @param {Function} [options.mcpLog] - MCP logger object (for MCP)
 * @param {string} [options.projectRoot] - Project root directory
 * @returns {Object} RESTful response with current model configuration
 */
async function getModelConfiguration(options = {}) {
	const { mcpLog, projectRoot } = options;
	const report = createReporter(mcpLog);

	assertConfigPresent(projectRoot);

	try {
		const availableModels = getAvailableModels(projectRoot);
		const describe = (provider, modelId) => {
			const modelData = availableModels.find(
				(m) => m.id === modelId && m.provider === provider
			);
			return {
				provider,
				modelId,
				sweScore: modelData?.swe_score || null,
				cost: modelData?.cost_per_1m_tokens || null
			};
		};

		const fallbackProvider = getFallbackProvider(projectRoot);

		return {
			success: true,
			data: {
				activeModels: {
					main: describe(
						getMainProvider(projectRoot),
						getMainModelId(projectRoot)
					),
					research: describe(
						getResearchProvider(projectRoot),
						getResearchModelId(projectRoot)
					),
					fallback: fallbackProvider
						? describe(fallbackProvider, getFallbackModelId(projectRoot))
						: null
				},
				message: 'Successfully retrieved current model configuration'
			}
		};
	} catch (error) {
		report('error', `Error getting model configuration: ${error.message}`);
		return {
			success: false,
			error: {
				code: 'CONFIG_ERROR',
				message: error.message
			}
		};
	}
}

/**
 * Get all available models
 * @param {Object} [options] - Options for the operation
 * @param {Function} [options.mcpLog] - MCP logger object (for MCP)
 * @param {string} [options.projectRoot] - Project root directory
 * @returns {Object} RESTful response with available models
 */
async function getAvailableModelsList(options = {}) {
	const { mcpLog, projectRoot } = options;
	const report = createReporter(mcpLog);

	assertConfigPresent(projectRoot);

	try {
		const models = getAvailableModels(projectRoot).map((model) => ({
			provider: model.provider || 'N/A',
			modelId: model.id,
			sweScore: model.swe_score || null,
			cost: model.cost_per_1m_tokens || null,
			allowedRoles: model.allowed_roles || []
		}));

		return {
			success: true,
			data: {
				models,
				message: models.length
					? `Successfully retrieved ${models.length} available models`
					: 'No available models found'
			}
		};
	} catch (error) {
		report('error', `Error getting available models: ${error.message}`);
		return {
			success: false,
			error: {
				code: 'MODELS_LIST_ERROR',
				message: error.message
			}
		};
	}
}

/**
 * Update a specific model in the configuration
 * @param {string} role - The model role to update ('main', 'research', 'fallback')
 * @param {string} modelId - The Claude Code model to set for the role (e.g. 'sonnet')
 * @param {Object} [options] - Options for the operation
 * @param {Function} [options.mcpLog] - MCP logger object (for MCP)
 * @param {string} [options.projectRoot] - Project root directory
 * @returns {Object} RESTful response with result of update operation
 */
async function setModel(role, modelId, options = {}) {
	const { mcpLog, projectRoot } = options;
	const report = createReporter(mcpLog);

	assertConfigPresent(projectRoot);

	if (!ROLES.includes(role)) {
		return {
			success: false,
			error: {
				code: 'INVALID_ROLE',
				message: `Invalid role: ${role}. Must be one of: ${ROLES.join(', ')}.`
			}
		};
	}

	if (typeof modelId !== 'string' || modelId.trim() === '') {
		return {
			success: false,
			error: {
				code: 'INVALID_MODEL_ID',
				message: `Invalid model ID: ${modelId}. Must be a non-empty string.`
			}
		};
	}

	try {
		const provider = CUSTOM_PROVIDERS.CLAUDE_CODE;
		const supportedModels = getAvailableModels(projectRoot).filter(
			(m) => m.provider === provider
		);
		const modelData = supportedModels.find((m) => m.id === modelId);

		if (!modelData) {
			return {
				success: false,
				error: {
					code: 'MODEL_NOT_FOUND',
					message: `Model ID "${modelId}" is not supported. TaskGraph uses Claude Code; valid models: ${supportedModels.map((m) => m.id).join(', ')}.`
				}
			};
		}

		const currentConfig = getConfig(projectRoot);
		currentConfig.models[role] = {
			...currentConfig.models[role], // Keep existing params like temperature
			provider,
			modelId
		};
		delete currentConfig.models[role].baseURL;

		if (modelData.max_tokens) {
			currentConfig.models[role].maxTokens = modelData.max_tokens;
		}

		if (!writeConfig(currentConfig, projectRoot)) {
			return {
				success: false,
				error: {
					code: 'CONFIG_WRITE_ERROR',
					message: 'Error writing updated configuration to configuration file'
				}
			};
		}

		const successMessage = `Successfully set ${role} model to ${modelId} (Provider: ${provider})`;
		report('info', successMessage);

		return {
			success: true,
			data: {
				role,
				provider,
				modelId,
				message: successMessage
			}
		};
	} catch (error) {
		report('error', `Error setting ${role} model: ${error.message}`);
		return {
			success: false,
			error: {
				code: 'SET_MODEL_ERROR',
				message: error.message
			}
		};
	}
}

export { getModelConfiguration, getAvailableModelsList, setModel };
