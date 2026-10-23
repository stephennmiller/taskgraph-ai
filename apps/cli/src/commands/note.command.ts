/**
 * @fileoverview `taskgraph note <id> "text"`: log progress on a task or
 * subtask as written, with no AI call. Thin layer over tm-core's
 * tasks.addNote(), which appends the note with a timestamp under the
 * tasks.json lock. `--file -` reads the note from stdin.
 */

import fs from 'node:fs';
import { type TmCore, createTmCore } from '@tm/core';
import { Command } from 'commander';
import { formatNoteAdded } from '../ui/formatters/task-update-formatters.js';
import { displayError, printError } from '../utils/error-handler.js';
import { getProjectRoot } from '../utils/project-root.js';

export interface NoteCommandOptions {
	file?: string;
	tag?: string;
	project?: string;
}

const USAGE_HINT = 'Write it after the ID: `taskgraph note 3 "what you did"`';

export class NoteCommand extends Command {
	private tmCore?: TmCore;

	constructor(name?: string) {
		super(name || 'note');

		this.description('Log a progress note on a task, as written (no AI)')
			.argument('<id>', 'Task or subtask ID (3 or 3.2)')
			.argument('[text...]', 'The note; quote it to keep spacing')
			.option('-f, --file <path>', 'Read the note from a file, or - for stdin')
			.option('-t, --tag <tag>', 'Use a specific tag')
			.option(
				'-p, --project <path>',
				'Project root directory (auto-detected if not provided)'
			)
			.action(
				async (id: string, words: string[], options: NoteCommandOptions) => {
					await this.executeCommand(id, words, options);
				}
			);
	}

	private async executeCommand(
		id: string,
		words: string[],
		options: NoteCommandOptions
	): Promise<void> {
		const inline = words.join(' ');
		if (inline && options.file) {
			printError(
				'Pass the note as text or with --file, not both',
				'Use one: `taskgraph note 3 "text"` or `taskgraph note 3 --file notes.md`'
			);
			process.exit(1);
		}

		let text = inline;
		if (options.file) {
			try {
				text = fs.readFileSync(options.file === '-' ? 0 : options.file, 'utf8');
			} catch (error: any) {
				printError(
					`Couldn't read ${options.file}: ${error.code ?? error.message}`,
					'Check the path, or pipe the note in with `--file -`'
				);
				process.exit(1);
			}
		}
		if (!text.trim()) {
			printError('The note is empty', USAGE_HINT);
			process.exit(1);
		}

		let hasError = false;
		try {
			this.tmCore = await createTmCore({
				projectPath: getProjectRoot(options.project)
			});
			const note = await this.tmCore.tasks.addNote(id, text, {
				tag: options.tag
			});
			console.log(formatNoteAdded(note));
		} catch (error: any) {
			hasError = true;
			displayError(error, { skipExit: true });
		} finally {
			this.tmCore = undefined;
		}
		if (hasError) process.exit(1);
	}

	static register(program: Command, name?: string): NoteCommand {
		const command = new NoteCommand(name);
		program.addCommand(command);
		return command;
	}
}
