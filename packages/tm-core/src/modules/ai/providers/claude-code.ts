/**
 * @fileoverview Claude Code provider implementation using the
 * ai-sdk-provider-claude-code package. This provider uses the local Claude
 * Agent SDK (via Claude Code CLI) with OAuth token authentication.
 *
 * Authentication:
 * - Uses CLAUDE_CODE_OAUTH_TOKEN managed by Claude Code CLI
 * - Token is set up via: claude setup-token
 * - No manual API key configuration required
 *
 * ai-sdk-provider-claude-code loads in getClient, not on import: it pulls in
 * the Agent SDK, which took about 0.4 s on every command (#248).
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { readProjectEnv } from '../../config/services/project-env.js';
import { findOnPath } from '../../git/merge-driver/merge-driver-files.js';
import {
	BaseAIProvider,
	type ModelFactory,
	type ProviderCallParams,
	type ProviderLog
} from './base-provider.js';
import {
	createGrepResultHook,
	createPathGuardHook
} from './claude-code-path-guard.js';

/** `claudeCode` from config, merged with the command's `commandSpecific` entry */
export type ClaudeCodeConfigSettings = Record<string, any>;

export interface ClaudeCodeProviderOptions {
	log: ProviderLog;
	/** The config's Claude Code settings for a command */
	getSettingsForCommand: (
		commandName?: string
	) => ClaudeCodeConfigSettings | null | undefined;
	/** Model IDs from supported-models.json */
	supportedModels: string[];
}

let _claudeCliChecked = false;

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
// Not claude.cmd: the SDK spawns it without a shell, which Node refuses on
// Windows (EINVAL), and a shell would expose the prompt arguments to cmd.exe
const CLAUDE_EXECUTABLE_NAME = /^claude(\.exe)?$/i;

function isWithin(root: string, candidate: string): boolean {
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
 * `claude` (`claude.exe`; not npm's `claude.cmd` shim) that is outside the
 * project, both as written and after resolving symlinks.
 * @param candidate - Configured executable path
 * @param projectRoot - Project root, when known
 */
export function isTrustedClaudeExecutable(
	candidate: unknown,
	projectRoot: string | null
): boolean {
	if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) {
		return false;
	}
	if (!CLAUDE_EXECUTABLE_NAME.test(path.basename(candidate))) return false;
	let real: string;
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

/** Keys Claude Code may take from the project's .env: the documented key and proxy settings */
const PROJECT_ENV_KEYS = [
	'CLAUDE_CODE_API_KEY',
	'HTTPS_PROXY',
	'HTTP_PROXY',
	'NO_PROXY'
];

/**
 * Drop an untrusted `pathToClaudeCodeExecutable` from config settings.
 * @returns Settings safe to pass to the SDK
 */
function withTrustedExecutable(
	settings: ClaudeCodeConfigSettings,
	projectRoot: string | null,
	log: ProviderLog
): ClaudeCodeConfigSettings {
	const executable = settings.pathToClaudeCodeExecutable;
	if (
		executable === undefined ||
		isTrustedClaudeExecutable(executable, projectRoot)
	) {
		return settings;
	}
	log(
		'warn',
		`Ignoring pathToClaudeCodeExecutable "${executable}": it must be an absolute path to a file named claude (claude.exe on Windows, not claude.cmd) outside the project`
	);
	const { pathToClaudeCodeExecutable: _dropped, ...rest } = settings;
	return rest;
}

/**
 * The Agent SDK's platform binary (an optional dependency, skipped by
 * `--omit=optional`), if it is installed where the SDK looks for it.
 */
export function bundledClaudeBinary(): string | undefined {
	const sdkPath = createRequire(
		createRequire(import.meta.url).resolve('ai-sdk-provider-claude-code')
	).resolve('@anthropic-ai/claude-agent-sdk');
	const sdkRequire = createRequire(sdkPath);
	const base = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`;
	const exe = process.platform === 'win32' ? 'claude.exe' : 'claude';
	// The SDK tries both Linux libc variants, so either one will do
	for (const pkg of [base, `${base}-musl`]) {
		try {
			const binary = sdkRequire.resolve(`${pkg}/${exe}`);
			if (fs.existsSync(binary)) return binary;
		} catch {
			// Not installed
		}
	}
	return undefined;
}

/**
 * The `claude` on PATH, for when the SDK has no binary of its own. The SDK
 * doesn't look on PATH itself. Only a trusted one (outside the project).
 * @param bundled - Whether the SDK's own binary is installed
 */
export function claudeFromPath(
	projectRoot: string | null,
	bundled = bundledClaudeBinary() !== undefined
): string | undefined {
	if (bundled) return undefined;
	const claude = findOnPath(
		'claude',
		undefined,
		process.platform === 'win32' ? ['.exe'] : undefined
	);
	return claude && isTrustedClaudeExecutable(claude, projectRoot)
		? claude
		: undefined;
}

/**
 * Settings that confine a Claude Code session to the tools its role needs.
 * Applied after user config so config cannot widen the tool set, reopen
 * settings sources or move the file boundary.
 * @param role - 'main', 'research' or 'fallback'
 * @param settings - Settings from config, used for maxTurns
 * @param projectRoot - Directory file tools are confined to
 */
function getRoleRestrictions(
	role: string | undefined,
	settings: ClaudeCodeConfigSettings,
	projectRoot: string | null
) {
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
	readonly supportedModels: string[];
	private readonly getSettingsForCommand: ClaudeCodeProviderOptions['getSettingsForCommand'];

	constructor(options: ClaudeCodeProviderOptions) {
		super(options.log);
		this.name = 'Claude Code';
		this.supportedModels = options.supportedModels;
		this.getSettingsForCommand = options.getSettingsForCommand;

		// Validate that models were loaded successfully
		if (this.supportedModels.length === 0) {
			this.log(
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
	 * @returns The environment variable name for API key (not used)
	 */
	getRequiredApiKeyName(): string {
		return 'CLAUDE_CODE_API_KEY';
	}

	/**
	 * @returns False - Claude Code doesn't require API keys
	 */
	isRequiredApiKey(): boolean {
		return false;
	}

	/**
	 * Optional CLI availability check for Claude Code
	 */
	validateAuth(_params?: Partial<ProviderCallParams>): void {
		// Claude Code uses local CLI - perform lightweight availability check
		// This is optional validation that fails fast with actionable guidance
		if (
			process.env.NODE_ENV !== 'test' &&
			!_claudeCliChecked &&
			!process.env.CLAUDE_CODE_OAUTH_TOKEN
		) {
			try {
				execSync('claude --version', { stdio: 'pipe', timeout: 1000 });
			} catch {
				// Not a problem: the Agent SDK ships its own Claude Code binary, so
				// AI calls work without a global install. Only worth a debug note.
				this.log(
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
	 * @param params.commandName - Command name for settings lookup
	 * @param params.role - AI role ('main', 'research', 'fallback') used to restrict tools
	 * @param params.projectRoot - Directory file tools are confined to; without it main and fallback get no file tools
	 * @throws If Claude Code CLI is not available or client creation fails
	 */
	async getClient(
		params: Partial<ProviderCallParams> = {}
	): Promise<ModelFactory> {
		try {
			const projectRoot = params.projectRoot
				? path.resolve(params.projectRoot)
				: null;

			let settings = withTrustedExecutable(
				this.getSettingsForCommand(params.commandName) || {},
				projectRoot,
				this.log
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
			// The host's variables win over the project's .env, as in tm-core's config.
			// A cloned repo's .env is untrusted, so only these keys come from it.
			const projectEnv = projectRoot ? readProjectEnv(projectRoot) : {};
			const env = { ...process.env };
			for (const key of PROJECT_ENV_KEYS) {
				if (projectEnv[key] !== undefined) env[key] = projectEnv[key];
			}
			const apiKey = env.CLAUDE_CODE_API_KEY;
			if (apiKey) {
				env.ANTHROPIC_API_KEY = apiKey;
			} else {
				delete env.ANTHROPIC_API_KEY;
			}

			const { createClaudeCode } = await import('ai-sdk-provider-claude-code');
			const defaultSettings: ClaudeCodeConfigSettings = {
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
					debug: (message: string) => this.log('debug', message),
					info: (message: string) => this.log('debug', message),
					warn: (message: string) => this.log('debug', message),
					error: (message: string) => this.log('error', message)
				},
				...settings,
				...getRoleRestrictions(params.role, settings, projectRoot)
			};
			return createClaudeCode({ defaultSettings }) as unknown as ModelFactory;
		} catch (error: any) {
			// Provide more helpful error message
			const msg = String(error?.message || '');
			const code = error?.code;
			// A missing npm package names claude too, but reinstalling fixes it
			if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') {
				this.handleError(
					'client initialization',
					new Error(
						`A package TaskGraph needs is missing; reinstall TaskGraph. Original error: ${msg}`,
						{ cause: error }
					)
				);
			}
			if (code === 'ENOENT' || /claude/i.test(msg)) {
				const enhancedError = new Error(
					`Claude Code CLI not available. Please install Claude Code CLI first. Original error: ${error.message}`,
					{ cause: error }
				);
				this.handleError('Claude Code CLI initialization', enhancedError);
			}
			this.handleError('client initialization', error);
		}
	}

	/**
	 * @returns List of supported model IDs
	 */
	getSupportedModels(): string[] {
		return this.supportedModels;
	}

	/**
	 * Check if a model is supported
	 */
	isModelSupported(modelId: unknown): boolean {
		if (!modelId) return false;
		return this.supportedModels.includes(String(modelId).toLowerCase());
	}
}
