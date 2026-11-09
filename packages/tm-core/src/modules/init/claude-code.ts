/**
 * @fileoverview init's Claude Code integration: `.taskgraph/CLAUDE.md` (the
 * AGENTS.md asset) imported from the project's CLAUDE.md, and, only with
 * `init --mcp`, the TaskGraph MCP server in `.mcp.json`. Slash commands ship
 * as the Claude Code plugin; the copies an older init wrote are removed.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pruneLegacySlashCommands } from '@tm/profiles';
import { TASKGRAPH_PACKAGE } from '../../common/constants/index.js';
import { getLogger } from '../../common/logger/index.js';
import {
	MCP_SERVER_KEY,
	launchesTaskGraphPackage
} from '../setup/mcp-server.js';
import { writeProjectFile } from '../storage/adapters/file-storage/file-operations.js';
import { readAsset } from './assets.js';

/** Where init reports a step that failed without stopping it */
export type InitReport = (level: 'warn' | 'error', message: string) => void;

/** The rule profiles init can install; TaskGraph supports Claude Code only */
export const RULE_PROFILES = ['claude'] as const;
export type RulesProfile = (typeof RULE_PROFILES)[number];

/** Names in the list that are not supported rule profiles, in input order */
export function findInvalidRulesProfiles(names: string[]): string[] {
	return names.filter(
		(name) => !(RULE_PROFILES as readonly string[]).includes(name)
	);
}

const IMPORT_LINE = '@./.taskgraph/CLAUDE.md';
const IMPORT_SECTION = `\n## TaskGraph Instructions\n**Import TaskGraph's development workflow commands and guidelines, treat as if import is in the main CLAUDE.md file.**\n${IMPORT_LINE}`;

const errorText = (error: unknown) => (error as Error).message;

/** CLAUDE.md and .mcp.json may link to another project file, as init allows */
const writeRootFile = (projectRoot: string, file: string, content: string) =>
	writeProjectFile(projectRoot, file, content, { linkInProject: true });

/** Set up Claude Code in `projectRoot`; `mcp` also writes `.mcp.json` */
export function setUpClaudeCode(
	projectRoot: string,
	{ mcp }: { mcp: boolean },
	report: InitReport
): void {
	const log = getLogger('Init');

	// Remove the command copies an older init wrote; the plugin replaces them
	try {
		const { removed } = pruneLegacySlashCommands(projectRoot);
		if (removed.length > 0) {
			log.debug(
				`[Claude] Removed ${removed.length} old slash command files from .claude/commands/tm`
			);
		}
	} catch (error) {
		report(
			'error',
			`[Claude] Failed to remove old slash command files: ${errorText(error)}`
		);
	}

	const userClaudeFile = path.join(projectRoot, 'CLAUDE.md');
	try {
		writeProjectFile(
			projectRoot,
			path.join('.taskgraph', 'CLAUDE.md'),
			readAsset('AGENTS.md')
		);
		if (fs.existsSync(userClaudeFile)) {
			const content = fs.readFileSync(userClaudeFile, 'utf8');
			if (!content.includes(IMPORT_LINE)) {
				writeRootFile(
					projectRoot,
					userClaudeFile,
					`${content.trim()}\n${IMPORT_SECTION}\n`
				);
			}
		} else {
			writeRootFile(
				projectRoot,
				userClaudeFile,
				`# Claude Code Instructions\n${IMPORT_SECTION}\n`
			);
		}
	} catch (error) {
		report(
			'error',
			`[Claude] Failed to set up Claude instructions: ${errorText(error)}`
		);
	}

	if (!mcp) return;
	try {
		setUpMcpConfig(projectRoot, report);
	} catch (error) {
		report('error', `MCP setup failed: ${errorText(error)}`);
	}
	// Claude Code's format: `type` first in each server
	const mcpPath = path.join(projectRoot, '.mcp.json');
	if (fs.existsSync(mcpPath)) {
		try {
			const config = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
			writeRootFile(
				projectRoot,
				mcpPath,
				`${JSON.stringify(transformToClaudeFormat(config), null, '\t')}\n`
			);
		} catch (error) {
			report(
				'error',
				`[Claude] Failed to transform MCP configuration: ${errorText(error)}`
			);
		}
	}
}

type ServerConfig = Record<string, unknown>;

/** Put `type: 'stdio'` first in each server; keeps only `mcpServers` */
export function transformToClaudeFormat(mcpConfig: {
	mcpServers?: Record<string, ServerConfig>;
}): { mcpServers?: Record<string, ServerConfig> } {
	if (!mcpConfig.mcpServers) return {};
	const mcpServers: Record<string, ServerConfig> = Object.create(null);
	for (const [name, server] of Object.entries(mcpConfig.mcpServers)) {
		const reordered: ServerConfig = Object.create(null);
		reordered.type = 'stdio';
		if (server.command) reordered.command = server.command;
		if (server.args) reordered.args = server.args;
		if (server.env) reordered.env = server.env;
		for (const key of Object.keys(server)) {
			if (!['command', 'args', 'env', 'type'].includes(key)) {
				reordered[key] = server[key];
			}
		}
		mcpServers[name] = reordered;
	}
	return { mcpServers };
}

/** JSON with tabs, and arrays of plain values on one line */
function formatJSONWithTabs(obj: unknown): string {
	return JSON.stringify(obj, null, '\t').replace(
		/(\[\n\t+)([^[\]]+?)(\n\t+\])/g,
		(match, _open, content: string) => {
			if (content.includes('{') || content.includes('[')) return match;
			return `[${content.replace(/\n\t+/g, ' ').replace(/\s+/g, ' ').trim()}]`;
		}
	);
}

/** `taskgraph-ai` or `taskgraph-ai@1.2.3`; a dist-tag, range or path is the user's choice */
const PINNABLE_SPEC = /^taskgraph-ai(@\d+\.\d+\.\d+(-[\w.]+)?)?$/;
/** Commands that read the args after them as npm package specs */
const PACKAGE_RUNNER = /(^|[\\/])(npx|bunx|pnpx|pnpm|npm|yarn)(\.cmd|\.exe)?$/i;

/** Pin a bare or version-pinned spec, only after a package runner (not e.g. `docker run taskgraph-ai`) */
function pinArgs(server: { command?: unknown; args: unknown[] }): unknown[] {
	let afterRunner = PACKAGE_RUNNER.test(String(server.command ?? ''));
	return server.args.map((arg) => {
		if (typeof arg !== 'string') return arg;
		if (afterRunner && PINNABLE_SPEC.test(arg)) return TASKGRAPH_PACKAGE;
		if (PACKAGE_RUNNER.test(arg)) afterRunner = true;
		return arg;
	});
}

/** Add the TaskGraph server to `.mcp.json`, creating the file if needed */
function setUpMcpConfig(projectRoot: string, report: InitReport): void {
	const mcpPath = path.join(projectRoot, '.mcp.json');
	// "core" loads the 7 essential daily workflow tools (see tool tiers)
	const server = {
		command: 'npx',
		args: ['-y', TASKGRAPH_PACKAGE],
		env: { TASKGRAPH_TOOLS: 'core' }
	};
	const fresh = () =>
		writeRootFile(
			projectRoot,
			mcpPath,
			`${formatJSONWithTabs({ mcpServers: { [MCP_SERVER_KEY]: server } })}\n`
		);

	if (!fs.existsSync(mcpPath)) {
		fresh();
		return;
	}
	try {
		const config = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
		if (!config.mcpServers) config.mcpServers = {};
		// A server that already launches this package is kept, with a bare or
		// version-pinned spec moved to this version
		const existing = Object.values(config.mcpServers).filter(
			launchesTaskGraphPackage
		) as { command?: unknown; args: unknown[] }[];
		for (const found of existing) found.args = pinArgs(found);
		if (existing.length === 0 && !config.mcpServers[MCP_SERVER_KEY]) {
			config.mcpServers[MCP_SERVER_KEY] = server;
		}
		writeRootFile(projectRoot, mcpPath, `${formatJSONWithTabs(config)}\n`);
	} catch (error) {
		// Recovered: the old file is kept beside the new one. If this throws,
		// setUpClaudeCode reports the failure.
		const backupName = `.mcp.json.backup-${Date.now()}`;
		writeProjectFile(projectRoot, backupName, fs.readFileSync(mcpPath));
		fresh();
		report(
			'warn',
			`Couldn't update .mcp.json: ${errorText(error)}. Saved it as ${backupName} and wrote a new one`
		);
	}
}
