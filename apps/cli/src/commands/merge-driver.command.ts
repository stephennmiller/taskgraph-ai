/**
 * @fileoverview `taskgraph merge-driver %O %A %B %P`: the Git merge driver for
 * tasks.json. Git runs it; people don't, so it's hidden from help and Tab
 * completion. `taskgraph init` (or `init --merge-driver`) sets it up.
 *
 * Thin layer over tm-core's runTasksMergeDriver(): exit 0 when merged, 1 when
 * a change clashes or a version can't be read, so git marks the file as
 * conflicted.
 */

import path from 'node:path';
import { archivePathFor, runTasksMergeDriver } from '@tm/core';
import { Command } from 'commander';
import {
	formatMergeConflicts,
	formatMergeRenumbered
} from '../ui/formatters/merge-driver-formatters.js';
import { printError } from '../utils/error-handler.js';

const SIDE_NAMES = {
	base: "common ancestor's",
	ours: "this branch's",
	theirs: 'incoming'
} as const;

export class MergeDriverCommand extends Command {
	constructor(name?: string) {
		super(name || 'merge-driver');

		this.description('Git merge driver for tasks.json (git runs it)')
			.argument('<base>', 'The common ancestor (%O)')
			.argument('<ours>', 'This branch, where the result goes (%A)')
			.argument('<theirs>', 'The branch being merged in (%B)')
			.argument('[path]', 'The file being merged (%P)')
			.action((base: string, ours: string, theirs: string, file?: string) => {
				this.executeCommand(base, ours, theirs, file);
			});
	}

	private executeCommand(
		basePath: string,
		oursPath: string,
		theirsPath: string,
		file = '.taskgraph/tasks/tasks.json'
	): void {
		// Git runs the driver at the top of the working tree, so `file` (%P)
		// finds the archive.json beside it; new tasks never take archived IDs
		const outcome = runTasksMergeDriver({
			basePath,
			oursPath,
			theirsPath,
			archivePath: archivePathFor(path.resolve(file))
		});

		if (outcome.status === 'unreadable') {
			printError(
				`Couldn't merge ${file}: the ${SIDE_NAMES[outcome.side]} version isn't a valid tasks file`,
				"Kept this branch's version; fix the file by hand, then git add it"
			);
			process.exitCode = 1;
			return;
		}

		if (outcome.status === 'conflicted') {
			console.error(
				formatMergeConflicts(outcome.conflicts, file, outcome.renumbered)
			);
			process.exitCode = 1;
			return;
		}

		const line = formatMergeRenumbered(outcome.renumbered);
		if (line) console.log(line);
	}
}
