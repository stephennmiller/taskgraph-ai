/**
 * ai-services-unified.js
 * Wires the legacy config-manager and logger into @tm/core's AiService, which
 * does role fallback, retries and usage telemetry. Callers keep these exports.
 */

import { AiService } from '@tm/core';
import {
	MODEL_MAP,
	getClaudeCodeSettingsForCommand,
	getDebugFlag,
	getFallbackModelId,
	getFallbackProvider,
	getMainModelId,
	getMainProvider,
	getParametersForRole,
	getResearchModelId,
	getResearchProvider,
	getResponseLanguage,
	getSupportedModelsForProvider,
	getUserId
} from './config-manager.js';
import {
	findProjectRoot,
	getCurrentTag,
	log,
	resolveEnvVariable
} from './utils.js';

// Built and every getter read at call time: tests mock these modules with only
// the exports they need, and reading a missing one at import would throw
let service;
const ai = () =>
	(service ??= new AiService({
		log: (...args) => log(...args),
		getDebugFlag: () => getDebugFlag(),
		findProjectRoot: () => findProjectRoot(),
		getRoleModel: (role, projectRoot) => {
			const [getProvider, getModelId] = {
				main: [getMainProvider, getMainModelId],
				research: [getResearchProvider, getResearchModelId],
				fallback: [getFallbackProvider, getFallbackModelId]
			}[role];
			return {
				provider: getProvider(projectRoot),
				modelId: getModelId(projectRoot)
			};
		},
		getParametersForRole: (role, projectRoot) =>
			getParametersForRole(role, projectRoot),
		getResponseLanguage: (projectRoot) => getResponseLanguage(projectRoot),
		getUserId: (projectRoot) => getUserId(projectRoot),
		getCurrentTag: (projectRoot) => getCurrentTag(projectRoot),
		resolveEnvVariable: (name, session, projectRoot) =>
			resolveEnvVariable(name, session, projectRoot),
		getClaudeCodeSettingsForCommand: (commandName) =>
			getClaudeCodeSettingsForCommand(commandName),
		getSupportedModels: (provider) => getSupportedModelsForProvider(provider),
		getModelMap: () => MODEL_MAP
	}));

export const streamObjectService = (params) => ai().streamObject(params);
export const generateObjectService = (params) => ai().generateObject(params);
export const logAiUsage = (params) => ai().logUsage(params);
