/**
 * src/ai-providers/claude-code.js
 *
 * Claude Code provider implementation using the ai-sdk-provider-claude-code package.
 * This provider uses the local Claude Agent SDK (via Claude Code CLI) with OAuth token authentication.
 *
 * Authentication:
 * - Uses CLAUDE_CODE_OAUTH_TOKEN managed by Claude Code CLI
 * - Token is set up via: claude setup-token
 * - No manual API key configuration required
 *
 */

import { execSync } from 'child_process';
import path from 'path';
import { createClaudeCode } from 'ai-sdk-provider-claude-code';
import {
	getClaudeCodeSettingsForCommand,
	getSupportedModelsForProvider
} from '../../scripts/modules/config-manager.js';
import { log } from '../../scripts/modules/utils.js';
import { createPathGuardHook } from './claude-code-path-guard.js';
import { BaseAIProvider } from './base-provider.js';

let _claudeCliChecked = false;
let _claudeCliAvailable = null;

// Tools each role may use. Everything else is denied (deny by default).
// Research reaches the web but has no file or shell tools, so a hostile page
// cannot drive local file access. Other roles can read files for codebase
// analysis but cannot reach the web or write anything.
//
// Isolation, for every role:
// - settingSources: [] loads no user, project or local settings, so a repo's
//   hooks, CLAUDE.md, permission rules and MCP config never run inside
//   TaskGraph's AI calls.
// Main and fallback additionally:
// - cwd is the project root and no additionalDirectories are added.
// - A programmatic PreToolUse hook denies Read/Grep/Glob calls that resolve
//   (symlinks included) outside the project root. Programmatic hooks are not
//   settings, so they still run with no settings sources.
const RESEARCH_TOOLS = ['WebSearch', 'WebFetch'];
const REPO_READ_TOOLS = ['Read', 'Grep', 'Glob'];
const DEFAULT_RESEARCH_MAX_TURNS = 8;

/**
 * Settings that confine a Claude Code session to the tools its role needs.
 * Applied after user config so config cannot widen the tool set, reopen
 * settings sources or move the file boundary.
 * @param {string} [role] - 'main', 'research' or 'fallback'
 * @param {object} settings - Settings from config, used for maxTurns
 * @param {string} projectRoot - Directory file tools are confined to
 * @returns {object} SDK settings
 */
function getRoleRestrictions(role, settings, projectRoot) {
	const isResearch = role === 'research';
	const tools = isResearch ? RESEARCH_TOOLS : REPO_READ_TOOLS;

	return {
		tools: [...tools],
		allowedTools: [...tools],
		// Anything not listed is denied instead of prompting
		permissionMode: 'dontAsk',
		permissionPrompts: 'none',
		// Ignore MCP servers from user settings and claude.ai connectors
		strictMcpConfig: true,
		mcpServers: {},
		// Do not inherit user hooks, CLAUDE.md or permission rules
		settingSources: [],
		...(isResearch
			? { maxTurns: settings.maxTurns ?? DEFAULT_RESEARCH_MAX_TURNS }
			: {
					cwd: projectRoot,
					additionalDirectories: undefined,
					hooks: { PreToolUse: [createPathGuardHook(projectRoot)] }
				})
	};
}

/**
 * Provider for Claude Code CLI integration via AI SDK
 *
 * Features:
 * - No API key required (uses local Claude Code CLI)
 * - Supported models loaded from supported-models.json
 * - Command-specific configuration support
 */
export class ClaudeCodeProvider extends BaseAIProvider {
	constructor() {
		super();
		this.name = 'Claude Code';
		// Load supported models from supported-models.json
		this.supportedModels = getSupportedModelsForProvider('claude-code');

		// Validate that models were loaded successfully
		if (this.supportedModels.length === 0) {
			log(
				'warn',
				'No supported models found for claude-code provider. Check supported-models.json configuration.'
			);
		}

		// Claude Code requires explicit JSON schema mode
		this.needsExplicitJsonSchema = true;
		// Claude Code does not support temperature parameter
		this.supportsTemperature = false;
	}

	/**
	 * @returns {string} The environment variable name for API key (not used)
	 */
	getRequiredApiKeyName() {
		return 'CLAUDE_CODE_API_KEY';
	}

	/**
	 * @returns {boolean} False - Claude Code doesn't require API keys
	 */
	isRequiredApiKey() {
		return false;
	}

	/**
	 * Optional CLI availability check for Claude Code
	 * @param {object} params - Parameters (ignored)
	 */
	validateAuth(params) {
		// Claude Code uses local CLI - perform lightweight availability check
		// This is optional validation that fails fast with actionable guidance
		if (
			process.env.NODE_ENV !== 'test' &&
			!_claudeCliChecked &&
			!process.env.CLAUDE_CODE_OAUTH_TOKEN
		) {
			try {
				execSync('claude --version', { stdio: 'pipe', timeout: 1000 });
				_claudeCliAvailable = true;
			} catch (error) {
				_claudeCliAvailable = false;
				// Not a problem: the Agent SDK ships its own Claude Code binary, so
				// AI calls work without a global install. Only worth a debug note.
				log(
					'debug',
					'No `claude` on PATH; using the Claude Code bundled with the Agent SDK'
				);
			} finally {
				_claudeCliChecked = true;
			}
		}
	}

	/**
	 * Creates a Claude Code client instance
	 * @param {object} params - Client parameters
	 * @param {string} [params.commandName] - Command name for settings lookup
	 * @param {string} [params.role] - AI role ('main', 'research', 'fallback') used to restrict tools
	 * @param {string} [params.projectRoot] - Directory file tools are confined to (defaults to the current directory)
	 * @returns {Function} Claude Code provider function
	 * @throws {Error} If Claude Code CLI is not available or client creation fails
	 */
	getClient(params = {}) {
		try {
			const settings =
				getClaudeCodeSettingsForCommand(params.commandName) || {};

			const projectRoot = path.resolve(params.projectRoot || process.cwd());

			// The SDK reads the environment when a query runs, so the key choice has
			// to travel with the client rather than be swapped around this call.
			// CLAUDE_CODE_API_KEY, when set, is used exclusively; otherwise
			// ANTHROPIC_API_KEY is withheld so Claude Code uses its own sign-in.
			const env = { ...process.env };
			if (process.env.CLAUDE_CODE_API_KEY) {
				env.ANTHROPIC_API_KEY = process.env.CLAUDE_CODE_API_KEY;
			} else {
				delete env.ANTHROPIC_API_KEY;
			}

			return createClaudeCode({
				defaultSettings: {
					// Restore previous default behavior from pre-2.0 versions
					// These must be inside defaultSettings to be applied by the provider
					systemPrompt: {
						type: 'preset',
						preset: 'claude_code'
					},
					env,
					// The SDK's own warnings (e.g. "unknown tool ID") are internal; keep
					// them out of the terminal unless debug logging is on
					logger: {
						debug: (message) => log('debug', message),
						info: (message) => log('debug', message),
						warn: (message) => log('debug', message),
						error: (message) => log('error', message)
					},
					...settings,
					...getRoleRestrictions(params.role, settings, projectRoot)
				}
			});
		} catch (error) {
			// Provide more helpful error message
			const msg = String(error?.message || '');
			const code = error?.code;
			if (code === 'ENOENT' || /claude/i.test(msg)) {
				const enhancedError = new Error(
					`Claude Code CLI not available. Please install Claude Code CLI first. Original error: ${error.message}`
				);
				enhancedError.cause = error;
				this.handleError('Claude Code CLI initialization', enhancedError);
			} else {
				this.handleError('client initialization', error);
			}
		}
	}

	/**
	 * @returns {string[]} List of supported model IDs
	 */
	getSupportedModels() {
		return this.supportedModels;
	}

	/**
	 * Check if a model is supported
	 * @param {string} modelId - Model ID to check
	 * @returns {boolean} True if supported
	 */
	isModelSupported(modelId) {
		if (!modelId) return false;
		return this.supportedModels.includes(String(modelId).toLowerCase());
	}
}
