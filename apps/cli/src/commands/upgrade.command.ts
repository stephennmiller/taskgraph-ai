/**
 * @fileoverview `taskgraph upgrade`: install the latest TaskGraph.
 *
 * A normal command only says when a newer version is out. This is the
 * explicit install. It still refuses in CI, without a terminal, for JSON
 * output, and from `loop` or a parallel worker.
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
				const reason = autoUpdateSkipReason();
				if (reason) {
					console.log(theme.muted(`Not installing (${reason})`));
					process.exitCode = 1;
					return;
				}

				const info = await checkForUpdate(TASKGRAPH_VERSION);
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
				if (!(await performAutoUpdate(info.latestVersion))) {
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
