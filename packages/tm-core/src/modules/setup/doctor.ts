/**
 * @fileoverview `taskgraph doctor`: checks that each setup step worked.
 * Setup is several steps (npm install, `init`, two `/plugin` commands, an
 * optional MCP server), and a missing one otherwise shows up only when a
 * slash command fails mid-conversation.
 *
 * Returns data only; the CLI words it. Claude Code is asked through its own
 * CLI (`claude --version`, `claude auth status`, `claude plugin list`), so
 * the checks follow wherever it keeps its settings. Without a `claude` on
 * PATH, the copy bundled with the Agent SDK is asked instead, since AI
 * commands run with that one too.
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
import { bundledClaudeBinary } from '../ai/providers/claude-code.js';
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
	/** Claude Code: only the copy bundled with the Agent SDK was found, not one on PATH */
	bundled?: boolean;
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
	/** The Claude Code bundled with the Agent SDK, null for none; defaults to the installed one */
	bundledClaude?: string | null;
}

/** The plugin's id in `claude plugin list` starts with its name */
const PLUGIN_ID_PREFIX = 'taskgraph@';
const COMMAND_TIMEOUT_MS = 15_000;

/**
 * Runs commands with a deadline. A command that exits non-zero still gives
 * its stdout (`claude auth status` exits 1 when signed out); one that can't
 * start, or runs past the deadline, gives null. At the deadline execFile
 * kills the command and closes its output pipes, so nothing can hang doctor.
 */
export function createCommandRunner(
	timeoutMs: number = COMMAND_TIMEOUT_MS
): CommandRunner {
	return (command, args, cwd) =>
		new Promise((resolve) => {
			// npm installs `claude` as a .cmd shim, which Windows runs only
			// through a shell. The arguments are fixed strings, so the shell
			// sees nothing from the user; one string avoids Node's DEP0190.
			// A full path (the bundled claude.exe) runs directly, so cmd.exe
			// never parses its spaces, `&` or `%`
			const windows = process.platform === 'win32' && !path.isAbsolute(command);
			execFile(
				windows ? [command, ...args].join(' ') : command,
				windows ? [] : args,
				{
					cwd,
					timeout: timeoutMs,
					shell: windows,
					windowsHide: true,
					// Don't let cmd.exe run a claude.cmd planted in the project
					env: windows
						? { ...process.env, NoDefaultCurrentDirectoryInExePath: '1' }
						: process.env
				},
				(error, stdout) => {
					if (!error) return resolve(stdout);
					const exitedNonZero = typeof error.code === 'number' && !error.killed;
					resolve(exitedNonZero && stdout ? stdout : null);
				}
			);
		});
}

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
function checkClaude(
	versionOutput: string | null,
	bundled: boolean
): DoctorCheck {
	if (versionOutput === null) {
		return { name: 'claude', status: 'fail', problem: 'not-found' };
	}
	const version = versionOutput.trim().split(/\s+/)[0];
	return {
		name: 'claude',
		status: 'pass',
		detail: version || undefined,
		...(bundled && { bundled })
	};
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
	/** Set instead of installPath for a plugin loaded in place from its marketplace folder */
	readFromFolder?: unknown;
	/** The project a `project` or `local` scope install belongs to */
	projectPath?: unknown;
}

/** The folder the plugin loads from, if `claude plugin list` names one */
function pluginFolder(plugin: ListedPlugin): string | null {
	if (typeof plugin.installPath === 'string') return plugin.installPath;
	if (typeof plugin.readFromFolder === 'string') return plugin.readFromFolder;
	return null;
}

function checkPlugin(
	listOutput: string | null,
	cliVersion: string,
	root: string
): DoctorCheck {
	const listed = parseJson(listOutput);
	if (!Array.isArray(listed)) return { name: 'plugin', status: 'skip' };
	// One entry per scope it's installed at; project and local installs count
	// only in their own project, and an enabled one decides
	const candidates = (listed as ListedPlugin[]).filter(
		(entry) =>
			typeof entry?.id === 'string' &&
			entry.id.startsWith(PLUGIN_ID_PREFIX) &&
			(typeof entry.projectPath !== 'string' ||
				samePath(entry.projectPath, root))
	);
	const plugin =
		candidates.find((entry) => entry.enabled !== false) ?? candidates[0];
	if (!plugin) {
		return { name: 'plugin', status: 'fail', problem: 'not-installed' };
	}
	const folder = pluginFolder(plugin);
	const manifest = folder ? readPluginManifest(folder) : null;
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

/** The ways Claude Code may have written a project path: as given, real, with / */
function pathForms(dir: string): string[] {
	let real = dir;
	try {
		real = fs.realpathSync(dir);
	} catch {
		// Keep the path as given
	}
	return [...new Set([dir, real].flatMap((p) => [p, p.replace(/\\/g, '/')]))];
}

function samePath(a: string, b: string): boolean {
	const forms = new Set(pathForms(b));
	return pathForms(a).some((form) => forms.has(form));
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
	const projectServers = pathForms(root).map(
		(key) => claudeConfig?.projects?.[key]?.mcpServers
	);
	if (projectServers.some(launchesTaskGraph)) {
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
	const run = options.run ?? createCommandRunner();
	const cliVersion = options.cliVersion ?? TASKGRAPH_VERSION;
	const root = path.resolve(resolveProjectRoot(options.projectPath));
	const inProject = isTaskGraphProject(root);
	// Project settings can enable or disable the plugin, so ask from the project
	const cwd = inProject ? root : process.cwd();

	const ask = (command: string) =>
		Promise.all([
			run(command, ['--version'], cwd),
			run(command, ['auth', 'status', '--json'], cwd),
			run(command, ['plugin', 'list', '--json'], cwd)
		]);
	let answers = await ask('claude');
	let bundled = false;
	if (answers[0] === null) {
		const binary =
			options.bundledClaude === undefined
				? bundledClaudeBinary()
				: options.bundledClaude;
		if (binary) {
			answers = await ask(binary);
			bundled = true;
		}
	}
	const [claudeVersion, authStatus, pluginList] = answers;
	const claude = checkClaude(claudeVersion, bundled);
	const claudeFound = claude.status === 'pass';

	const checks: DoctorCheck[] = [
		checkNode(options.nodeVersion ?? process.versions.node),
		claude,
		claudeFound
			? checkSignedIn(authStatus)
			: { name: 'signed-in', status: 'skip' },
		checkProject(root),
		claudeFound
			? checkPlugin(pluginList, cliVersion, root)
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
