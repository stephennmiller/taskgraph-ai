/**
 * init's import flag (UPSTREAM_IMPORT_FLAG from @tm/core): the steps init.js
 * calls, kept here so init.js itself barely changes. The import logic lives
 * in @tm/core and the summary text in @tm/cli.
 */

import { printError, ui } from '@tm/cli';
import {
	UPSTREAM_DIR,
	UPSTREAM_IMPORT_OPTION,
	UpstreamImportError,
	checkUpstreamImport,
	importUpstreamProject
} from '@tm/core';
import { isSilentMode } from './utils.js';

/** Whether init was asked to import the upstream project */
export const wantsUpstreamImport = (options = {}) =>
	Boolean(options[UPSTREAM_IMPORT_OPTION]);

/**
 * Before the banner, prompts or any write: stop init when the import can't
 * run. The CLI prints the reason and its fix and exits 1; silent callers get
 * the UpstreamImportError.
 */
export function ensureUpstreamImportCanRun(options, projectRoot) {
	if (!wantsUpstreamImport(options)) return;
	try {
		checkUpstreamImport(projectRoot);
	} catch (error) {
		if (!(error instanceof UpstreamImportError) || isSilentMode()) throw error;
		printError(error.message, error.hint);
		process.exit(1);
	}
}

/** The dry-run line for the import, or none */
export const upstreamImportDryRunLines = (options) =>
	wantsUpstreamImport(options)
		? [`  import tasks, docs, reports and settings from ${UPSTREAM_DIR}/`]
		: [];

/**
 * Import the upstream project's folder after init has set up .taskgraph/.
 * @returns {import('@tm/core').UpstreamImportResult | undefined}
 */
export const runUpstreamImport = (targetDir, options, dryRun) =>
	wantsUpstreamImport(options) && !dryRun
		? importUpstreamProject(targetDir)
		: undefined;

/**
 * Print what the import moved, in place of init's usual summary.
 * @param {import('@tm/core').UpstreamImportResult} result
 * @param {{path: string, note: string}[]} changes - init's other changes
 * @param {string} taskgraphDir - shown as `.taskgraph/`, left out of changes
 */
export function printUpstreamImportSummary(result, changes, taskgraphDir) {
	console.log(
		`${ui.formatUpstreamImport({
			result,
			changes: changes.filter((change) => change.path !== `${taskgraphDir}/`)
		})}\n`
	);
}
