/**
 * @fileoverview The one-time "TaskGraph now keeps a separate task list per
 * tag" notice. A run that migrates an old tasks.json sets
 * `migrationNoticePending` in state.json; the CLI shows the notice once,
 * after the next command.
 */

import fs from 'node:fs';
import path from 'node:path';
import { TASKGRAPH_STATE_FILE } from '../../common/constants/paths.js';
import { resolveProjectRoot } from '../../common/utils/project-root-finder.js';

/**
 * Whether the migration notice is due, marking it shown when it is.
 *
 * It used to show for any project whose state.json said the notice hadn't
 * been shown, which included every new project after its first tasks were
 * created, so only `migrationNoticePending` counts.
 *
 * @param projectRoot - Defaults to TASKGRAPH_PROJECT_ROOT, else the root found from the working directory
 * @returns true once per migration, and on every run while state.json can't
 * be written; false when nothing is due or state.json can't be read
 */
export function takeMigrationNotice(projectRoot?: string): boolean {
	let statePath = TASKGRAPH_STATE_FILE;
	let state: Record<string, unknown> | null;
	try {
		statePath = path.join(
			resolveProjectRoot(projectRoot),
			TASKGRAPH_STATE_FILE
		);
		state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
	} catch (error) {
		// No state.json is the usual case; a broken one must not fail the command that just ran
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
			debugWarn(`Could not read ${statePath} for the migration notice`, error);
		}
		return false;
	}
	if (state?.migrationNoticePending !== true) return false;
	try {
		state.migrationNoticePending = false;
		state.migrationNoticeShown = true;
		fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
	} catch (error) {
		// Still show it, as before #254; it shows again until the write succeeds
		debugWarn(
			`Could not mark the migration notice shown in ${statePath}`,
			error
		);
	}
	return true;
}

function debugWarn(message: string, error: unknown): void {
	if (process.env.TASKGRAPH_DEBUG !== 'true') return;
	const code = (error as NodeJS.ErrnoException).code;
	console.warn(
		`[WARN] ${message}: ${code ?? (error as Error).message ?? String(error)}`
	);
}
