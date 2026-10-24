/**
 * @fileoverview Run a command's work on a TmCore, after the `[tag] X` line
 */

import { type TmCore, createTmCore } from '@tm/core';
import { displayCommandHeader } from './display-helpers.js';
import { displayError } from './error-handler.js';
import { getProjectRoot } from './project-root.js';

/**
 * Run `action` on a TmCore after the `[tag] X` line; any error is printed
 * and exits 1
 */
export async function withTmCore(
	options: { tag?: string; project?: string },
	action: (tmCore: TmCore) => Promise<void>
): Promise<void> {
	let tmCore: TmCore | undefined;
	try {
		tmCore = await createTmCore({
			projectPath: getProjectRoot(options.project)
		});
		displayCommandHeader({
			tag: options.tag || tmCore.config.getActiveTag(),
			projectRoot: tmCore.projectPath
		});
		await action(tmCore);
	} catch (error: unknown) {
		displayError(error, { skipExit: true });
		process.exitCode = 1;
	} finally {
		await tmCore?.close();
	}
}
