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
import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { createClaudeCode } from 'ai-sdk-provider-claude-code';
import {
	getClaudeCodeSettingsForCommand,
	getSupportedModelsForProvider
} from '../../scripts/modules/config-manager.js';
import { findOnPath, readProjectEnv } from '@tm/core';
import { log } from '../../scripts/modules/utils.js';
import {
	createGrepResultHook,
	createPathGuardHook
} from './claude-code-path-guard.js';
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
// - cwd is the project root and no additionalDirectories are added. With no
//   known project root they get no file tools at all.
// - A programmatic PreToolUse hook denies Read/Grep/Glob calls that resolve
//   (symlinks included) outside the project root, and a PostToolUse hook drops
//   Grep matches from secret files. Programmatic hooks are not settings, so
//   they still run with no settings sources.
const RESEARCH_TOOLS = ['WebSearch', 'WebFetch'];
const REPO_READ_TOOLS = ['Read', 'Grep', 'Glob'];
const DEFAULT_RESEARCH_MAX_TURNS = 8;
// Main and fallback get the project summary in the prompt (see
// getRepoSummary), so a few file reads are enough. Without a cap a call can
// spend most of its tokens exploring the repo. `claudeCode.maxTurns` (or a
// command's `commandSpecific` entry) overrides it.
const DEFAULT_MAX_TURNS = 6;
const CLAUDE_EXECUTABLE_NAME = /^claude(\.exe|\.cmd)?$/i;

function isWithin(root, candidate) {
	const relative = path.relative(root, candidate);
	return (
		relative === '' ||
		(relative !== '..' &&
			!relative.startsWith(`..${path.sep}`) &&
			!path.isAbsolute(relative))
	);
}

/**
 * Whether `pathToClaudeCodeExecutable` from config may be run. It comes from
 * the project's own .taskgraph/config.json, so a repo you didn't write could
 * otherwise name any program. Allowed: an absolute path to a file named
 * `claude` (`claude.exe`, `claude.cmd`) that is outside the project, both as
 * written and after resolving symlinks.
 * @param {string} candidate - Configured executable path
 * @param {string|null} projectRoot - Project root, when known
 * @returns {boolean}
 */
export function isTrustedClaudeExecutable(candidate, projectRoot) {
	if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) {
		return false;
	}
	if (!CLAUDE_EXECUTABLE_NAME.test(path.basename(candidate))) return false;
	let real;
	try {
		real = fs.realpathSync(candidate);
	} catch {
		return false;
	}
	if (!projectRoot) return true;
	const root = path.resolve(projectRoot);
	let realRoot = root;
	try {
		realRoot = fs.realpathSync(root);
	} catch {
		// Use the root as given
	}
	return !isWithin(root, path.resolve(candidate)) && !isWithin(realRoot, real);
}

/**
 * Drop an untrusted `pathToClaudeCodeExecutable` from config settings.
 * @param {object} settings - Settings from config
 * @param {string|null} projectRoot
 * @returns {object} Settings safe to pass to the SDK
 */
function withTrustedExecutable(settings, projectRoot) {
	const executable = settings.pathToClaudeCodeExecutable;
	if (
		executable === undefined ||
		isTrustedClaudeExecutable(executable, projectRoot)
	) {
		return settings;
	}
	log(
		'warn',
		`Ignoring pathToClaudeCodeExecutable "${executable}": it must be an absolute path to a file named claude outside the project`
	);
	const { pathToClaudeCodeExecutable, ...rest } = settings;
	return rest;
}

/**
 * Whether the Agent SDK's platform binary (an optional dependency, skipped by
 * `--omit=optional`) is installed where the SDK looks for it.
 * @returns {boolean}
 */
export function hasBundledClaudeBinary() {
	const sdkPath = createRequire(
		createRequire(import.meta.url).resolve('ai-sdk-provider-claude-code')
	).resolve('@anthropic-ai/claude-agent-sdk');
	const sdkRequire = createRequire(sdkPath);
	const base = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`;
	const exe = process.platform === 'win32' ? 'claude.exe' : 'claude';
	// The SDK tries both Linux libc variants, so either one will do
	return [base, `${base}-musl`].some((pkg) => {
		try {
			return fs.existsSync(sdkRequire.resolve(`${pkg}/${exe}`));
		} catch {
			return false;
		}
	});
}

/**
 * The `claude` on PATH, for when the SDK has no binary of its own. The SDK
 * doesn't look on PATH itself. Only a trusted one (outside the project).
 * @param {string|null} projectRoot
 * @param {boolean} [bundled] - Whether the SDK's own binary is installed
 * @returns {string|undefined}
 */
export function claudeFromPath(
	projectRoot,
	bundled = hasBundledClaudeBinary()
) {
	if (bundled) return undefined;
	const claude = findOnPath('claude');
	return claude && isTrustedClaudeExecutable(claude, projectRoot)
		? claude
		: undefined;
}

/**
 * Settings that confine a Claude Code session to the tools its role needs.
 * Applied after user config so config cannot widen the tool set, reopen
 * settings sources or move the file boundary.
 * @param {string} [role] - 'main', 'research' or 'fallback'
 * @param {object} settings - Settings from config, used for maxTurns
 * @param {string|null} projectRoot - Directory file tools are confined to
 * @returns {object} SDK settings
 */
function getRoleRestrictions(role, settings, projectRoot) {
	const isResearch = role === 'research';
	// Without a known project root there is no boundary to enforce, so the
	// file tools are withheld rather than scoped to wherever the process runs
	const tools = isResearch
		? RESEARCH_TOOLS
		: projectRoot
			? REPO_READ_TOOLS
			: [];

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
		maxTurns:
			settings.maxTurns ??
			(isResearch ? DEFAULT_RESEARCH_MAX_TURNS : DEFAULT_MAX_TURNS),
		...(isResearch
			? {}
			: {
					cwd: projectRoot ?? undefined,
					additionalDirectories: undefined,
					hooks: projectRoot
						? {
								PreToolUse: [createPathGuardHook(projectRoot)],
								PostToolUse: [createGrepResultHook(projectRoot)]
							}
						: {}
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
	 * @param {string} [params.projectRoot] - Directory file tools are confined to; without it main and fallback get no file tools
	 * @returns {Function} Claude Code provider function
	 * @throws {Error} If Claude Code CLI is not available or client creation fails
	 */
	getClient(params = {}) {
		try {
			const projectRoot = params.projectRoot
				? path.resolve(params.projectRoot)
				: null;

			let settings = withTrustedExecutable(
				getClaudeCodeSettingsForCommand(params.commandName) || {},
				projectRoot
			);
			if (!settings.pathToClaudeCodeExecutable) {
				const claude = claudeFromPath(projectRoot);
				if (claude)
					settings = { ...settings, pathToClaudeCodeExecutable: claude };
			}

			// The SDK reads the environment when a query runs, so the key choice has
			// to travel with the client rather than be swapped around this call.
			// CLAUDE_CODE_API_KEY, when set, is used exclusively; otherwise
			// ANTHROPIC_API_KEY is withheld so Claude Code uses its own sign-in.
			// The host's variables win over the project's .env, as in tm-core's config
			const env = projectRoot
				? readProjectEnv(projectRoot)
				: { ...process.env };
			const apiKey = env.CLAUDE_CODE_API_KEY;
			if (apiKey) {
				env.ANTHROPIC_API_KEY = apiKey;
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
