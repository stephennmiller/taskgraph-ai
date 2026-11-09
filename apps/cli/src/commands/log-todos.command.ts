/**
 * @fileoverview `taskgraph log-todos`: the plugin's PostToolUse hook pipes
 * Claude Code's TodoWrite, TaskCreate or TaskUpdate call in, and once every
 * item is completed the list becomes one note on the task in progress
 * (#953, #1074), unless that's the task's last note already. The hook runs
 * it; people don't, so it's hidden. Thin layer over tm-core's todoListNote()
 * and tasks.addNote().
 *
 * The hook names its private folder, where the task tools' list is kept, in
 * TASKGRAPH_HOOK_DIR rather than a flag: a CLI without the flag would fail
 * on it, and log no TodoWrite list either.
 */

import { type TmCore, createTmCore, todoListNote } from '@tm/core';
import { Command } from 'commander';
import { getProjectRoot } from '../utils/project-root.js';
import { readNoteSource } from './note.command.js';

export class LogTodosCommand extends Command {
	private tmCore?: TmCore;

	constructor(name?: string) {
		super(name || 'log-todos');

		this.description(
			"Log Claude Code's finished todo list on the task in progress (the plugin runs it)"
		)
			.option(
				'-p, --project <path>',
				'Project root directory (auto-detected if not provided)'
			)
			.action(async (options: { project?: string }) => {
				await this.executeCommand(options);
			});
	}

	private async executeCommand(options: { project?: string }): Promise<void> {
		// A hook: a failure here must never get in Claude's way, so it's silent
		try {
			const text = todoListNote(
				await readNoteSource('-'),
				process.env.TASKGRAPH_HOOK_DIR || undefined
			);
			if (!text) return;
			this.tmCore = await createTmCore({
				projectPath: getProjectRoot(options.project)
			});
			// The same task the prompt hook shows as the one in progress
			const [task] = (await this.tmCore.tasks.getPrimeContext()).inProgress;
			if (task) {
				await this.tmCore.tasks.addNote(task.id, text, { skipRepeat: true });
			}
		} catch {
			// Nothing to report to: the hook discards output
		} finally {
			this.tmCore = undefined;
		}
	}
}
