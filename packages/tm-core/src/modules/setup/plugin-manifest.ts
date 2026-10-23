/**
 * @fileoverview The Claude Code plugin's manifest
 * (`.claude-plugin/plugin.json`): its version, and the taskgraph CLI range
 * its commands and hooks need, kept under `metadata.taskgraphCli`. The plugin
 * updates from git and the CLI from npm, so either can be ahead.
 */

import fs from 'node:fs';
import path from 'node:path';
import { TASKGRAPH_VERSION } from '../../common/constants/index.js';
import { satisfiesMinimum } from './version-range.js';

export interface PluginManifest {
	version?: string;
	/** The CLI versions the plugin works with, e.g. `>=0.57.2` */
	cliRange?: string;
}

/** What the installed CLI means for a plugin */
export type PluginCliCheck =
	| { ok: true }
	| { ok: false; cliVersion: string; cliRange: string };

/** Read `<pluginRoot>/.claude-plugin/plugin.json`, or null if it can't be */
export function readPluginManifest(pluginRoot: string): PluginManifest | null {
	try {
		const manifest = JSON.parse(
			fs.readFileSync(
				path.join(pluginRoot, '.claude-plugin', 'plugin.json'),
				'utf8'
			)
		);
		const range = manifest?.metadata?.taskgraphCli;
		return {
			version:
				typeof manifest?.version === 'string' ? manifest.version : undefined,
			cliRange: typeof range === 'string' ? range : undefined
		};
	} catch {
		return null;
	}
}

/**
 * Whether this CLI is new enough for the plugin installed at `pluginRoot`.
 * A plugin without a readable range passes: nothing says the CLI is too old.
 */
export function checkCliForPlugin(
	pluginRoot: string,
	cliVersion: string = TASKGRAPH_VERSION
): PluginCliCheck {
	const cliRange = readPluginManifest(pluginRoot)?.cliRange;
	if (!cliRange || satisfiesMinimum(cliVersion, cliRange)) return { ok: true };
	return { ok: false, cliVersion, cliRange };
}
