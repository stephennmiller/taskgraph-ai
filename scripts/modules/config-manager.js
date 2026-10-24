import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
	ALL_PROVIDERS,
	ClaudeCodeSettingsSchema,
	CUSTOM_PROVIDERS,
	CUSTOM_PROVIDERS_ARRAY,
	DEFAULT_PROJECT_CONFIG,
	dropOldNumTasksDefault,
	hasPerMachineSettings,
	mergeMachineConfig,
	readConfigJson,
	SUPPORTED_MODELS as MODEL_MAP,
	UNREADABLE_CONFIG,
	writeSplitConfig
} from '@tm/core';
import chalk from 'chalk';
import {
	TASKGRAPH_DIR,
	TASKGRAPH_LOCAL_CONFIG_FILE,
	TASKGRAPH_TASKS_FILE
} from '../../src/constants/paths.js';
import { findConfigPath } from '../../src/utils/path-utils.js';
import { findProjectRoot, isEmpty, log, resolveEnvVariable } from './utils.js';

// Calculate __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Default configuration values (used if config file is missing or incomplete)
const DEFAULTS = DEFAULT_PROJECT_CONFIG;

// --- Internal Config Loading ---
let loadedConfig = null;
let loadedConfigRoot = null; // Track which root loaded the config

/**
 * Suppress config file warnings (useful during API mode detection)
 * Uses global object so it can be shared across modules without circular deps
 * @param {boolean} suppress - Whether to suppress warnings
 */
export function setSuppressConfigWarnings(suppress) {
	global._tmSuppressConfigWarnings = suppress;
}

/**
 * Check if config warnings are currently suppressed
 * @returns {boolean}
 */
export function isConfigWarningSuppressed() {
	return global._tmSuppressConfigWarnings === true;
}

function _loadAndValidateConfig(explicitRoot = null) {
	const defaults = DEFAULTS; // Use the defined defaults
	let rootToUse = explicitRoot;
	let configSource = explicitRoot
		? `explicit root (${explicitRoot})`
		: 'defaults (no root provided yet)';

	// ---> If no explicit root, TRY to find it <---
	if (!rootToUse) {
		rootToUse = findProjectRoot();
		if (rootToUse) {
			configSource = `found root (${rootToUse})`;
		} else {
			// No root found, use current working directory as fallback
			// This prevents infinite loops during initialization
			rootToUse = process.cwd();
			configSource = `current directory (${rootToUse}) - no project markers found`;
		}
	}
	// ---> End find project root logic <---

	// --- Find configuration file ---
	let configPath = null;
	let config = structuredClone(defaults); // Callers change the result
	let configExists = false;

	// During initialization (no project markers), skip config file search entirely
	const hasProjectMarkers = fs.existsSync(path.join(rootToUse, TASKGRAPH_DIR));

	if (hasProjectMarkers) {
		// Only try to find config if we have project markers
		// This prevents the repeated warnings during init
		configPath = findConfigPath(null, { projectRoot: rootToUse });
	}

	if (configPath) {
		configExists = true;
		try {
			const rawData = fs.readFileSync(configPath, 'utf-8');
			let sharedConfig = JSON.parse(rawData);
			const cleaned = dropOldNumTasksDefault(sharedConfig);
			if (cleaned) {
				sharedConfig = cleaned;
				saveCleanedConfig(configPath, cleaned);
			}
			// This machine's settings (gitignored) override the shared file.
			// Merge after the cleanup, which saves only config.json's own keys.
			const parsedConfig = mergeMachineConfig(
				sharedConfig,
				readLocalConfig(rootToUse)
			);

			// Deep merge parsed config onto defaults
			config = {
				models: {
					main: { ...defaults.models.main, ...parsedConfig?.models?.main },
					research: {
						...defaults.models.research,
						...parsedConfig?.models?.research
					},
					fallback:
						parsedConfig?.models?.fallback?.provider &&
						parsedConfig?.models?.fallback?.modelId
							? { ...defaults.models.fallback, ...parsedConfig.models.fallback }
							: { ...defaults.models.fallback }
				},
				global: { ...defaults.global, ...parsedConfig?.global },
				claudeCode: { ...defaults.claudeCode, ...parsedConfig?.claudeCode }
			};
			configSource = `file (${configPath})`; // Update source info

			// --- Validation (Warn if file content is invalid) ---
			const unsupported = [];
			if (!validateProvider(config.models.main.provider)) {
				unsupported.push(
					`Main provider "${config.models.main.provider}" isn't supported; using ${defaults.models.main.modelId}`
				);
				config.models.main = { ...defaults.models.main };
			}
			if (!validateProvider(config.models.research.provider)) {
				unsupported.push(
					`Research provider "${config.models.research.provider}" isn't supported; using ${defaults.models.research.modelId}`
				);
				config.models.research = { ...defaults.models.research };
			}
			if (
				config.models.fallback?.provider &&
				!validateProvider(config.models.fallback.provider)
			) {
				unsupported.push(
					`Fallback provider "${config.models.fallback.provider}" isn't supported; no fallback model`
				);
				config.models.fallback.provider = undefined;
				config.models.fallback.modelId = undefined;
			}
			if (unsupported.length > 0) {
				console.warn(
					unsupported.map((line) => `${chalk.yellow('⚠')} ${line}`).join('\n') +
						chalk.dim(
							`\n  Run taskgraph models --setup to update ${path.relative(rootToUse, configPath)}`
						)
				);
			}
			if (config.claudeCode && !isEmpty(config.claudeCode)) {
				config.claudeCode = validateClaudeCodeSettings(config.claudeCode);
			}
		} catch (error) {
			// Use console.error for actual errors during parsing
			console.error(
				chalk.red(
					`Error reading or parsing ${configPath}: ${error.message}. Using default configuration.`
				)
			);
			config = structuredClone(defaults); // Reset to defaults on parse error
			configSource = `defaults (parse error at ${configPath})`;
		}
	} else {
		// Config file doesn't exist at the determined rootToUse.
		// Skip warnings if the global suppress flag is set
		// Don't warn during initialization: only an explicit root or a folder
		// with tasks is expected to have a config. An empty .taskgraph folder
		// isn't a project, so the "No TaskGraph project" error covers it.
		const expectsConfig =
			Boolean(explicitRoot) ||
			fs.existsSync(path.join(rootToUse, TASKGRAPH_TASKS_FILE));

		if (expectsConfig && !isConfigWarningSuppressed()) {
			warnMissingConfigOnce(explicitRoot || rootToUse);
		}
		// Keep config as defaults
		config = structuredClone(defaults);
		configSource = `defaults (no config file found at ${rootToUse})`;
	}

	return { config, root: rootToUse, fromFile: configExists };
}

// config.local.json files already reported as broken in this run
const warnedLocalConfigPaths = new Set();

/**
 * Read .taskgraph/config.local.json, the gitignored per-machine settings.
 * A broken file is reported and skipped so config.json still applies.
 * @param {string} root - Project root
 * @returns {object|null} The parsed settings, or null when there are none
 */
function readLocalConfig(root) {
	const localPath = path.join(root, TASKGRAPH_LOCAL_CONFIG_FILE);
	if (!fs.existsSync(localPath)) return null;
	try {
		return JSON.parse(fs.readFileSync(localPath, 'utf-8'));
	} catch (error) {
		if (warnedLocalConfigPaths.has(localPath)) return null;
		warnedLocalConfigPaths.add(localPath);
		console.warn(
			`${chalk.yellow('⚠')} Couldn't read ${TASKGRAPH_LOCAL_CONFIG_FILE}: ${error.message}\n` +
				chalk.dim('  Fix the JSON or delete the file; using config.json only')
		);
		return null;
	}
}

// Roots already warned about in this run. getConfig() runs several times per
// command and doesn't cache defaults loaded without a root, so the warning
// used to print up to five times in a row.
const warnedMissingConfigRoots = new Set();

/**
 * Warn, once per run and root, that a project has no config file.
 * @param {string} root - Project root that should have one
 */
function warnMissingConfigOnce(root) {
	if (warnedMissingConfigRoots.has(root)) return;
	warnedMissingConfigRoots.add(root);
	console.warn(
		`${chalk.yellow('⚠')} No .taskgraph/config.json in ${root}; using default settings\n` +
			chalk.dim('  Run taskgraph init to recreate it')
	);
}

/**
 * Gets the current configuration, loading it if necessary.
 * Handles MCP initialization context gracefully.
 * @param {string|null} explicitRoot - Optional explicit path to the project root.
 * @param {boolean} forceReload - Force reloading the config file.
 * @returns {object} The loaded configuration object.
 */
function getConfig(explicitRoot = null, forceReload = false) {
	// Determine if a reload is necessary
	const needsLoad =
		!loadedConfig ||
		forceReload ||
		(explicitRoot && explicitRoot !== loadedConfigRoot);

	if (needsLoad) {
		const { config, root, fromFile } = _loadAndValidateConfig(explicitRoot);

		// log() reads the config without a root on every call, so a file found
		// that way is cached too; each reload repeated its warnings (#269).
		// Defaults aren't cached, so a config written later in the run is found.
		if (forceReload || explicitRoot || fromFile) {
			loadedConfig = config;
			loadedConfigRoot = explicitRoot || root;
		}
		return config;
	}

	// If no load was needed, return the cached config
	return loadedConfig;
}

/**
 * Validates if a provider name is supported.
 * Custom providers (claude-code) are always allowed.
 * @param {string} providerName The name of the provider.
 * @returns {boolean} True if the provider is valid, false otherwise.
 */
function validateProvider(providerName) {
	// Custom providers are always allowed
	if (CUSTOM_PROVIDERS_ARRAY.includes(providerName)) {
		return true;
	}

	// Unknown providers are not allowed
	return false;
}

/**
 * Optional: Validates if a modelId is known for a given provider based on MODEL_MAP.
 * This is a non-strict validation; an unknown model might still be valid.
 * @param {string} providerName The name of the provider.
 * @param {string} modelId The model ID.
 * @returns {boolean} True if the modelId is in the map for the provider, false otherwise.
 */
function validateProviderModelCombination(providerName, modelId) {
	// If provider isn't even in our map, we can't validate the model
	if (!MODEL_MAP[providerName]) {
		return true; // Allow unknown providers or those without specific model lists
	}
	// If the provider is known, check if the model is in its list OR if the list is empty (meaning accept any)
	return (
		MODEL_MAP[providerName].length === 0 ||
		// Use .some() to check the 'id' property of objects in the array
		MODEL_MAP[providerName].some((modelObj) => modelObj.id === modelId)
	);
}

/**
 * Gets the list of supported model IDs for a given provider from supported-models.json
 * @param {string} providerName - The name of the provider (e.g., 'claude-code')
 * @returns {string[]} Array of supported model IDs, or empty array if provider not found
 */
export function getSupportedModelsForProvider(providerName) {
	if (!MODEL_MAP[providerName]) {
		return [];
	}
	return MODEL_MAP[providerName]
		.filter((model) => model.supported !== false)
		.map((model) => model.id);
}

/**
 * Validates Claude Code AI provider custom settings
 * @param {object} settings The settings to validate
 * @returns {object} The validated settings
 */
function validateClaudeCodeSettings(settings) {
	let validatedSettings = {};

	try {
		validatedSettings = ClaudeCodeSettingsSchema.parse(settings);
	} catch (error) {
		console.warn(
			chalk.yellow(
				`Warning: Invalid Claude Code settings in config: ${error.message}. Falling back to default.`
			)
		);

		validatedSettings = {};
	}

	return validatedSettings;
}

// --- Claude Code Settings Getters ---

function getClaudeCodeSettings(explicitRoot = null, forceReload = false) {
	const config = getConfig(explicitRoot, forceReload);
	// Ensure Claude Code defaults are applied if Claude Code section is missing
	return { ...DEFAULTS.claudeCode, ...(config?.claudeCode || {}) };
}

function getClaudeCodeSettingsForCommand(
	commandName,
	explicitRoot = null,
	forceReload = false
) {
	const settings = getClaudeCodeSettings(explicitRoot, forceReload);
	const commandSpecific = settings?.commandSpecific || {};
	return { ...settings, ...commandSpecific[commandName] };
}

// --- Role-Specific Getters ---

function getModelConfigForRole(role, explicitRoot = null) {
	const config = getConfig(explicitRoot);
	const roleConfig = config?.models?.[role];
	if (!roleConfig) {
		log(
			'warn',
			`No model configuration found for role: ${role}. Returning default.`
		);
		return DEFAULTS.models[role] || {};
	}
	return roleConfig;
}

function getMainProvider(explicitRoot = null) {
	return getModelConfigForRole('main', explicitRoot).provider;
}

function getMainModelId(explicitRoot = null) {
	return getModelConfigForRole('main', explicitRoot).modelId;
}

function getMainMaxTokens(explicitRoot = null) {
	// Directly return value from config (which includes defaults)
	return getModelConfigForRole('main', explicitRoot).maxTokens;
}

function getMainTemperature(explicitRoot = null) {
	// Directly return value from config
	return getModelConfigForRole('main', explicitRoot).temperature;
}

function getResearchProvider(explicitRoot = null) {
	return getModelConfigForRole('research', explicitRoot).provider;
}

/**
 * Check if codebase analysis feature flag is enabled across all sources
 * Priority: .env > MCP env > config.json
 * @param {object|null} session - MCP session object (optional)
 * @param {string|null} projectRoot - Project root path (optional)
 * @returns {boolean} True if codebase analysis is enabled
 */
function isCodebaseAnalysisEnabled(session = null, projectRoot = null) {
	// Priority 1: Environment variable
	const envFlag = resolveEnvVariable(
		'TASKGRAPH_ENABLE_CODEBASE_ANALYSIS',
		session,
		projectRoot
	);
	if (envFlag !== null && envFlag !== undefined && envFlag !== '') {
		return envFlag.toLowerCase() === 'true' || envFlag === '1';
	}

	// Priority 2: MCP session environment
	if (session?.env?.TASKGRAPH_ENABLE_CODEBASE_ANALYSIS) {
		const mcpFlag = session.env.TASKGRAPH_ENABLE_CODEBASE_ANALYSIS;
		return mcpFlag.toLowerCase() === 'true' || mcpFlag === '1';
	}

	// Priority 3: Configuration file
	const globalConfig = getGlobalConfig(projectRoot);
	return globalConfig.enableCodebaseAnalysis !== false; // Default to true
}

/**
 * Check if codebase analysis is available and enabled
 * @param {boolean} useResearch - Whether to check research provider or main provider
 * @param {string|null} projectRoot - Project root path (optional)
 * @param {object|null} session - MCP session object (optional)
 * @returns {boolean} True if codebase analysis is available and enabled
 */
function hasCodebaseAnalysis(
	useResearch = false,
	projectRoot = null,
	session = null
) {
	// First check if the feature is enabled
	if (!isCodebaseAnalysisEnabled(session, projectRoot)) {
		return false;
	}

	// The research role only has web tools, so it cannot explore the codebase
	if (useResearch) {
		return false;
	}

	// Then check if a codebase analysis provider is configured
	const currentProvider = useResearch
		? getResearchProvider(projectRoot)
		: getMainProvider(projectRoot);

	return currentProvider === CUSTOM_PROVIDERS.CLAUDE_CODE;
}

function getResearchModelId(explicitRoot = null) {
	return getModelConfigForRole('research', explicitRoot).modelId;
}

function getResearchMaxTokens(explicitRoot = null) {
	// Directly return value from config
	return getModelConfigForRole('research', explicitRoot).maxTokens;
}

function getResearchTemperature(explicitRoot = null) {
	// Directly return value from config
	return getModelConfigForRole('research', explicitRoot).temperature;
}

function getFallbackProvider(explicitRoot = null) {
	// Directly return value from config (will be undefined if not set)
	return getModelConfigForRole('fallback', explicitRoot).provider;
}

function getFallbackModelId(explicitRoot = null) {
	// Directly return value from config
	return getModelConfigForRole('fallback', explicitRoot).modelId;
}

function getFallbackMaxTokens(explicitRoot = null) {
	// Directly return value from config
	return getModelConfigForRole('fallback', explicitRoot).maxTokens;
}

function getFallbackTemperature(explicitRoot = null) {
	// Directly return value from config
	return getModelConfigForRole('fallback', explicitRoot).temperature;
}

// --- Global Settings Getters ---

function getGlobalConfig(explicitRoot = null) {
	const config = getConfig(explicitRoot);
	// Ensure global defaults are applied if global section is missing
	return { ...DEFAULTS.global, ...(config?.global || {}) };
}

function getLogLevel(explicitRoot = null) {
	// Directly return value from config
	return getGlobalConfig(explicitRoot).logLevel.toLowerCase();
}

function getDebugFlag(explicitRoot = null) {
	// Directly return value from config, ensure boolean
	return getGlobalConfig(explicitRoot).debug === true;
}

function getDefaultSubtasks(explicitRoot = null) {
	// Directly return value from config, ensure integer
	const val = getGlobalConfig(explicitRoot).defaultSubtasks;
	const parsedVal = parseInt(val, 10);
	return Number.isNaN(parsedVal) ? DEFAULTS.global.defaultSubtasks : parsedVal;
}

function getDefaultNumTasks(explicitRoot = null) {
	const val = getGlobalConfig(explicitRoot).defaultNumTasks;
	const parsedVal = parseInt(val, 10);
	return Number.isNaN(parsedVal) ? DEFAULTS.global.defaultNumTasks : parsedVal;
}

function getDefaultPriority(explicitRoot = null) {
	// Directly return value from config
	return getGlobalConfig(explicitRoot).defaultPriority;
}

function getProjectName(explicitRoot = null) {
	// Directly return value from config
	return getGlobalConfig(explicitRoot).projectName;
}

function getResponseLanguage(explicitRoot = null) {
	// Directly return value from config
	return getGlobalConfig(explicitRoot).responseLanguage;
}

function getCodebaseAnalysisEnabled(explicitRoot = null) {
	// Return boolean-safe value with default true
	return getGlobalConfig(explicitRoot).enableCodebaseAnalysis !== false;
}

/**
 * Gets model parameters (maxTokens, temperature) for a specific role,
 * considering model-specific overrides from supported-models.json.
 * @param {string} role - The role ('main', 'research', 'fallback').
 * @param {string|null} explicitRoot - Optional explicit path to the project root.
 * @returns {{maxTokens: number, temperature: number}}
 */
function getParametersForRole(role, explicitRoot = null) {
	const roleConfig = getModelConfigForRole(role, explicitRoot);
	const roleMaxTokens = roleConfig.maxTokens;
	const roleTemperature = roleConfig.temperature;
	const modelId = roleConfig.modelId;
	const providerName = roleConfig.provider;

	let effectiveMaxTokens = roleMaxTokens; // Start with the role's default
	let effectiveTemperature = roleTemperature; // Start with the role's default

	try {
		// Find the model definition in MODEL_MAP
		const providerModels = MODEL_MAP[providerName];
		if (providerModels && Array.isArray(providerModels)) {
			const modelDefinition = providerModels.find((m) => m.id === modelId);

			// Check if a model-specific max_tokens is defined and valid
			if (
				modelDefinition &&
				typeof modelDefinition.max_tokens === 'number' &&
				modelDefinition.max_tokens > 0
			) {
				const modelSpecificMaxTokens = modelDefinition.max_tokens;
				// Use the minimum of the role default and the model specific limit
				effectiveMaxTokens = Math.min(roleMaxTokens, modelSpecificMaxTokens);
				log(
					'debug',
					`Applying model-specific max_tokens (${modelSpecificMaxTokens}) for ${modelId}. Effective limit: ${effectiveMaxTokens}`
				);
			} else {
				log(
					'debug',
					`No valid model-specific max_tokens override found for ${modelId}. Using role default: ${roleMaxTokens}`
				);
			}

			// Check if a model-specific temperature is defined
			if (
				modelDefinition &&
				typeof modelDefinition.temperature === 'number' &&
				modelDefinition.temperature >= 0 &&
				modelDefinition.temperature <= 1
			) {
				effectiveTemperature = modelDefinition.temperature;
				log(
					'debug',
					`Applying model-specific temperature (${modelDefinition.temperature}) for ${modelId}`
				);
			}
		} else {
			log(
				'debug',
				`No model definitions found for provider ${providerName} in MODEL_MAP. Using role default maxTokens: ${roleMaxTokens}`
			);
		}
	} catch (lookupError) {
		log(
			'warn',
			`Error looking up model-specific parameters for ${modelId}: ${lookupError.message}. Using role defaults.`
		);
		// Fallback to role defaults on error
		effectiveMaxTokens = roleMaxTokens;
		effectiveTemperature = roleTemperature;
	}

	return {
		maxTokens: effectiveMaxTokens,
		temperature: effectiveTemperature
	};
}

/**
 * Checks whether a provider is ready to use without further setup.
 * Claude Code authenticates through the local Claude Code CLI, so no API key
 * is involved; any other provider is unsupported.
 * @param {string} providerName - The name of the provider.
 * @returns {boolean} True for the Claude Code provider, false otherwise.
 */
function isApiKeySet(providerName) {
	return providerName?.toLowerCase() === CUSTOM_PROVIDERS.CLAUDE_CODE;
}

/**
 * Gets a list of available models based on the MODEL_MAP.
 * @returns {Array<{id: string, name: string, provider: string, swe_score: number|null, cost_per_1m_tokens: {input: number|null, output: number|null}|null, allowed_roles: string[]}>}
 */
function getAvailableModels() {
	const available = [];
	for (const [provider, models] of Object.entries(MODEL_MAP)) {
		if (models.length > 0) {
			models
				.filter((modelObj) => Boolean(modelObj.supported))
				.forEach((modelObj) => {
					const modelId = modelObj.id;
					const sweScore = modelObj.swe_score;
					const cost = modelObj.cost_per_1m_tokens;
					const allowedRoles = modelObj.allowed_roles || ['main', 'fallback'];

					// Use name from JSON if available, otherwise generate from ID
					let name = modelObj.name;
					if (!name) {
						const nameParts = modelId
							.split('-')
							.map((p) => p.charAt(0).toUpperCase() + p.slice(1));
						name = nameParts.join(' ');
					}

					available.push({
						id: modelId,
						name: name,
						provider: provider,
						swe_score: sweScore,
						cost_per_1m_tokens: cost,
						allowed_roles: allowedRoles,
						max_tokens: modelObj.max_tokens
					});
				});
		}
	}
	return available;
}

/**
 * Writes the configuration object to the file. Only keys the file already
 * has or that differ from DEFAULTS are saved (see toSavedConfig).
 * @param {Object} config The configuration object to write.
 * @param {string|null} explicitRoot - Optional explicit path to the project root.
 * @returns {boolean} True if successful, false otherwise.
 */
function writeConfig(config, explicitRoot = null) {
	// ---> Determine root path reliably <---
	let rootPath = explicitRoot;
	if (explicitRoot === null || explicitRoot === undefined) {
		// Logic matching _loadAndValidateConfig
		const foundRoot = findProjectRoot(); // *** Explicitly call findProjectRoot ***
		if (!foundRoot) {
			console.error(
				chalk.red(
					'Error: Could not determine project root. Configuration not saved.'
				)
			);
			return false;
		}
		rootPath = foundRoot;
	}
	// ---> End determine root path logic <---

	// Use new config location: .taskgraph/config.json
	const taskgraphDir = path.join(rootPath, '.taskgraph');
	const configPath = path.join(taskgraphDir, 'config.json');

	try {
		// Ensure .taskgraph directory exists
		if (!fs.existsSync(taskgraphDir)) {
			fs.mkdirSync(taskgraphDir, { recursive: true });
		}

		writeSplitConfig(rootPath, config);
		loadedConfig = config; // Update the cache after successful write
		loadedConfigRoot = rootPath;
		return true;
	} catch (error) {
		console.error(
			chalk.red(
				`Error writing configuration to ${configPath}: ${error.message}`
			)
		);
		return false;
	}
}

/**
 * Save the one-time cleanup from dropOldNumTasksDefault. A read-only project
 * still gets the cleaned values for this run.
 */
function saveCleanedConfig(configPath, cleaned) {
	// Write a temp file and rename it, so another process reading config.json
	// at the same time never sees a half-written file
	const tempPath = `${configPath}.${process.pid}.tmp`;
	try {
		fs.writeFileSync(tempPath, JSON.stringify(cleaned, null, 2));
		fs.renameSync(tempPath, configPath);
	} catch {
		// Not fatal: the cleanup runs again on the next load
		fs.rmSync(tempPath, { force: true });
	}
}

/**
 * Move per-machine settings (such as claudeCode.pathToClaudeCodeExecutable)
 * that an earlier release kept in the shared config.json into
 * config.local.json. A value already in config.local.json wins. Does nothing
 * when config.json has none.
 * @param {string} rootPath - Project root
 * @returns {boolean} true when settings moved
 */
function moveMachineSettings(rootPath) {
	const configPath = path.join(rootPath, '.taskgraph', 'config.json');
	try {
		const shared = readConfigJson(configPath);
		if (!hasPerMachineSettings(shared)) return false;

		const local = readConfigJson(
			path.join(rootPath, TASKGRAPH_LOCAL_CONFIG_FILE)
		);
		// A broken config.local.json stays as it is; readLocalConfig reports it
		if (local === UNREADABLE_CONFIG) return false;
		writeSplitConfig(rootPath, mergeMachineConfig(shared, local));
	} catch (error) {
		log('warn', `Couldn't move per-machine settings: ${error.message}`);
		return false;
	}
	loadedConfig = null;
	return true;
}

/**
 * Checks if a configuration file exists at the project root (new or legacy location)
 * @param {string|null} explicitRoot - Optional explicit path to the project root
 * @returns {boolean} True if the file exists, false otherwise
 */
function isConfigFilePresent(explicitRoot = null) {
	return findConfigPath(null, { projectRoot: explicitRoot }) !== null;
}

/**
 * Gets the user ID from the configuration.
 * @param {string|null} explicitRoot - Optional explicit path to the project root.
 * @returns {string|null} The user ID or null if not found.
 */
function getUserId(explicitRoot = null) {
	const config = getConfig(explicitRoot);
	if (!config.global) {
		config.global = {}; // Ensure global object exists
	}
	if (!config.global.userId) {
		config.global.userId = '1234567890';
		// Attempt to write the updated config.
		// It's important that writeConfig correctly resolves the path
		// using explicitRoot, similar to how getConfig does.
		const success = writeConfig(config, explicitRoot);
		if (!success) {
			// Log an error or handle the failure to write,
			// though for now, we'll proceed with the in-memory default.
			log(
				'warning',
				'Failed to write updated configuration with new userId. Please let the developers know.'
			);
		}
	}
	return config.global.userId;
}

/**
 * Gets a list of all known provider names (both validated and custom).
 * @returns {string[]} An array of all provider names.
 */
function getAllProviders() {
	return ALL_PROVIDERS;
}

export {
	// Core config access
	getConfig,
	writeConfig,
	moveMachineSettings,
	isConfigFilePresent,
	// Claude Code settings
	getClaudeCodeSettings,
	getClaudeCodeSettingsForCommand,
	// Validation
	validateProvider,
	validateProviderModelCombination,
	validateClaudeCodeSettings,
	CUSTOM_PROVIDERS,
	ALL_PROVIDERS,
	MODEL_MAP,
	getAvailableModels,
	// Role-specific getters (No env var overrides)
	getMainProvider,
	getMainModelId,
	getMainMaxTokens,
	getMainTemperature,
	getResearchProvider,
	getResearchModelId,
	getResearchMaxTokens,
	getResearchTemperature,
	hasCodebaseAnalysis,
	getFallbackProvider,
	getFallbackModelId,
	getFallbackMaxTokens,
	getFallbackTemperature,
	// Global setting getters (No env var overrides)
	getLogLevel,
	getDebugFlag,
	getDefaultNumTasks,
	getDefaultSubtasks,
	getDefaultPriority,
	getProjectName,
	getResponseLanguage,
	getCodebaseAnalysisEnabled,
	isCodebaseAnalysisEnabled,
	getParametersForRole,
	getUserId,
	// Operating mode
	// API Key Checkers (still relevant)
	isApiKeySet,
	// ADD: Function to get all provider names
	getAllProviders
};
