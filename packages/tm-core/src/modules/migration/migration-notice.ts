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
 * @returns true once per migration; false when nothing is due or state.json can't be read or written
 */
export function takeMigrationNotice(projectRoot?: string): boolean {
	try {
		const statePath = path.join(
			resolveProjectRoot(projectRoot),
			TASKGRAPH_STATE_FILE
		);
		const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
		if (state?.migrationNoticePending !== true) return false;
		state.migrationNoticePending = false;
		state.migrationNoticeShown = true;
		fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
		return true;
	} catch {
		// No state.json, or a broken one, must not fail the command that just ran
		return false;
	}
}
