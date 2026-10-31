/**
 * @fileoverview `taskgraph upgrade`: install the latest TaskGraph.
 *
 * A normal command only says when a newer version is out. This is the
 * explicit install, so it refuses only in a process started by `loop` or
 * `loop --parallel`.
 */

import { TASKGRAPH_VERSION } from '@tm/core';
import { Command } from 'commander';
import { theme } from '../ui/theme.js';
import {
	checkForUpdate,
	displayUpgradeNotification,
	performAutoUpdate
} from '../utils/auto-update/index.js';
import { autoUpdateSkipReason } from '../utils/auto-update/policy.js';

export class UpgradeCommand extends Command {
	constructor(name?: string) {
		super(name || 'upgrade');

		this.description('Install the latest version of TaskGraph').action(
			async () => {
				const reason = autoUpdateSkipReason({ explicit: true });
				if (reason) {
					console.log(theme.muted(`Not installing (${reason})`));
					process.exitCode = 1;
					return;
				}

				// An explicit upgrade asks npm now, not a cached (or failed) check
				const info = await checkForUpdate(TASKGRAPH_VERSION, { fresh: true });
				if (info.failed) {
					console.error("Couldn't reach the npm registry, try again later");
					process.exitCode = 1;
					return;
				}
				if (!info.needsUpdate) {
					console.log(`TaskGraph ${info.currentVersion} is up to date`);
					return;
				}

				displayUpgradeNotification(
					info.currentVersion,
					info.latestVersion,
					info.highlights
				);
				// No restart: it would only run `upgrade` again on the new version
				if (
					!(await performAutoUpdate(info.latestVersion, { explicit: true }))
				) {
					process.exitCode = 1;
				}
			}
		);
	}

	static register(program: Command, name?: string): UpgradeCommand {
		const command = new UpgradeCommand(name);
		program.addCommand(command);
		return command;
	}
}
