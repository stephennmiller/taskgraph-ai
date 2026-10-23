/**
 * @fileoverview `taskgraph doctor`: checks that each setup step worked.
 * Setup is several steps (npm install, `init`, two `/plugin` commands, an
 * optional MCP server), and a missing one otherwise shows up only when a
 * slash command fails mid-conversation.
 *
 * Returns data only; the CLI words it. Claude Code is asked through its own
 * CLI (`claude --version`, `claude auth status`, `claude plugin list`), so
 * the checks follow wherever it keeps its settings.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	NODE_VERSION_RANGE,
	TASKGRAPH_VERSION
} from '../../common/constants/index.js';
import {
	isTaskGraphProject,
	resolveProjectRoot
} from '../../common/utils/project-root-finder.js';
import { launchesTaskGraphPackage } from './mcp-server.js';
import { readPluginManifest } from './plugin-manifest.js';
import { satisfiesMinimum } from './version-range.js';

export type DoctorCheckName =
	| 'node'
	| 'claude'
	| 'signed-in'
	| 'project'
	| 'plugin'
	| 'mcp';

/** `skip`: not checked (it depends on a failed check), or optional and unset */
export type DoctorStatus = 'pass' | 'fail' | 'skip';

export type DoctorProblem =
	/** Node, or this CLI for the installed plugin, is older than needed */
	| 'too-old'
	| 'not-found'
	| 'signed-out'
	| 'not-installed'
	| 'disabled'
	/** The optional MCP server isn't in the project's .mcp.json */
	| 'not-set-up';

export interface DoctorCheck {
	name: DoctorCheckName;
	status: DoctorStatus;
	/** What was found: a version, a path */
	detail?: string;
	problem?: DoctorProblem;
	/** The range a `too-old` check needed */
	required?: string;
}

export interface DoctorReport {
	checks: DoctorCheck[];
	/** The taskgraph CLI version the checks ran with */
	cliVersion: string;
	/** No check failed */
	ok: boolean;
}

/** Runs a command; resolves with its stdout, or null if it didn't run or failed */
export type CommandRunner = (
	command: string,
	args: string[],
	cwd: string
) => Promise<string | null>;

export interface DoctorOptions {
	/** Project root; defaults to TASKGRAPH_PROJECT_ROOT, then the one found from cwd */
	projectPath?: string;
	nodeVersion?: string;
	cliVersion?: string;
	run?: CommandRunner;
	/** Claude Code's `.claude.json`; defaults to the one in CLAUDE_CONFIG_DIR or home */
	claudeConfigFile?: string;
}

/** The plugin's id in `claude plugin list` starts with its name */
const PLUGIN_ID_PREFIX = 'taskgraph@';
const COMMAND_TIMEOUT_MS = 15_000;

const runCommand: CommandRunner = (command, args, cwd) =>
	new Promise((resolve) => {
		execFile(
			command,
			args,
			{
				cwd,
				timeout: COMMAND_TIMEOUT_MS,
				// npm installs `claude` as a .cmd shim on Windows. The arguments
				// are fixed strings, so the shell sees nothing from the user.
				shell: process.platform === 'win32',
				windowsHide: true
			},
			(error, stdout) => resolve(error ? null : stdout)
		);
	});

function parseJson(text: string | null): unknown {
	if (text === null) return undefined;
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

function checkNode(version: string): DoctorCheck {
	const ok = satisfiesMinimum(version, NODE_VERSION_RANGE);
	return ok
		? { name: 'node', status: 'pass', detail: version }
		: {
				name: 'node',
				status: 'fail',
				detail: version,
				problem: 'too-old',
				required: NODE_VERSION_RANGE
			};
}

function checkProject(root: string): DoctorCheck {
	return isTaskGraphProject(root)
		? { name: 'project', status: 'pass', detail: root }
		: { name: 'project', status: 'fail', detail: root, problem: 'not-found' };
}

/** `2.1.309 (Claude Code)` → `2.1.309` */
function checkClaude(versionOutput: string | null): DoctorCheck {
	if (versionOutput === null) {
		return { name: 'claude', status: 'fail', problem: 'not-found' };
	}
	const version = versionOutput.trim().split(/\s+/)[0];
	return { name: 'claude', status: 'pass', detail: version || undefined };
}

function checkSignedIn(statusOutput: string | null): DoctorCheck {
	const status = parseJson(statusOutput) as { loggedIn?: unknown } | undefined;
	if (typeof status?.loggedIn !== 'boolean') {
		return { name: 'signed-in', status: 'skip' };
	}
	return status.loggedIn
		? { name: 'signed-in', status: 'pass' }
		: { name: 'signed-in', status: 'fail', problem: 'signed-out' };
}

interface ListedPlugin {
	id?: unknown;
	enabled?: unknown;
	installPath?: unknown;
}

function checkPlugin(
	listOutput: string | null,
	cliVersion: string
): DoctorCheck {
	const listed = parseJson(listOutput);
	if (!Array.isArray(listed)) return { name: 'plugin', status: 'skip' };
	const plugin = (listed as ListedPlugin[]).find(
		(entry) =>
			typeof entry?.id === 'string' && entry.id.startsWith(PLUGIN_ID_PREFIX)
	);
	if (!plugin) {
		return { name: 'plugin', status: 'fail', problem: 'not-installed' };
	}
	const manifest =
		typeof plugin.installPath === 'string'
			? readPluginManifest(plugin.installPath)
			: null;
	const detail = manifest?.version;
	if (plugin.enabled === false) {
		return { name: 'plugin', status: 'fail', detail, problem: 'disabled' };
	}
	const range = manifest?.cliRange;
	if (range && !satisfiesMinimum(cliVersion, range)) {
		return {
			name: 'plugin',
			status: 'fail',
			detail,
			problem: 'too-old',
			required: range
		};
	}
	return { name: 'plugin', status: 'pass', detail };
}

type McpServers = Record<string, unknown> | undefined;

const launchesTaskGraph = (servers: McpServers) =>
	Object.values(servers ?? {}).some(launchesTaskGraphPackage);

/** Claude Code's own config file, which holds user- and local-scope MCP servers */
function claudeConfigFile(): string {
	const dir = process.env.CLAUDE_CONFIG_DIR || os.homedir();
	return path.join(dir, '.claude.json');
}

/**
 * The optional MCP server, wherever Claude Code reads it from: the project's
 * .mcp.json (`taskgraph init --mcp`), or Claude Code's config for this
 * project or for every project (`claude mcp add`). Read from the files,
 * because `claude mcp get` starts the server to health-check it.
 */
function checkMcp(root: string, configFile: string): DoctorCheck {
	const project = parseJson(readText(path.join(root, '.mcp.json'))) as
		| { mcpServers?: McpServers }
		| undefined;
	if (launchesTaskGraph(project?.mcpServers)) {
		return { name: 'mcp', status: 'pass', detail: '.mcp.json' };
	}
	const claudeConfig = parseJson(readText(configFile)) as
		| {
				mcpServers?: McpServers;
				projects?: Record<string, { mcpServers?: McpServers } | undefined>;
		  }
		| undefined;
	if (launchesTaskGraph(claudeConfig?.projects?.[root]?.mcpServers)) {
		return { name: 'mcp', status: 'pass', detail: 'Claude Code, this project' };
	}
	if (launchesTaskGraph(claudeConfig?.mcpServers)) {
		return { name: 'mcp', status: 'pass', detail: 'Claude Code, all projects' };
	}
	return { name: 'mcp', status: 'skip', problem: 'not-set-up' };
}

function readText(file: string): string | null {
	try {
		return fs.readFileSync(file, 'utf8');
	} catch {
		return null;
	}
}

/**
 * Check Node, Claude Code and its sign-in, the project, the plugin and the
 * MCP server. Checks that need Claude Code are skipped when it's missing.
 */
export async function runDoctor(
	options: DoctorOptions = {}
): Promise<DoctorReport> {
	const run = options.run ?? runCommand;
	const cliVersion = options.cliVersion ?? TASKGRAPH_VERSION;
	const root = path.resolve(resolveProjectRoot(options.projectPath));
	const inProject = isTaskGraphProject(root);
	// Project settings can enable or disable the plugin, so ask from the project
	const cwd = inProject ? root : process.cwd();

	const [claudeVersion, authStatus, pluginList] = await Promise.all([
		run('claude', ['--version'], cwd),
		run('claude', ['auth', 'status', '--json'], cwd),
		run('claude', ['plugin', 'list', '--json'], cwd)
	]);
	const claude = checkClaude(claudeVersion);
	const claudeFound = claude.status === 'pass';

	const checks: DoctorCheck[] = [
		checkNode(options.nodeVersion ?? process.versions.node),
		claude,
		claudeFound
			? checkSignedIn(authStatus)
			: { name: 'signed-in', status: 'skip' },
		checkProject(root),
		claudeFound
			? checkPlugin(pluginList, cliVersion)
			: { name: 'plugin', status: 'skip' },
		inProject
			? checkMcp(root, options.claudeConfigFile ?? claudeConfigFile())
			: { name: 'mcp', status: 'skip' }
	];
	return {
		checks,
		cliVersion,
		ok: checks.every((check) => check.status !== 'fail')
	};
}
