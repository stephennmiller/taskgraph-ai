/**
 * @fileoverview `taskgraph note <id> "text"`: log progress on a task or
 * subtask as written, with no AI call. Thin layer over tm-core's
 * tasks.addNote(), which appends the note with a timestamp under the
 * tasks.json lock. `--file -` reads the note from stdin.
 */

import fs from 'node:fs';
import { MAX_NOTE_BYTES, type TmCore, createTmCore } from '@tm/core';
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

/** Thrown by readNoteSource when the source is bigger than a note may be */
class NoteTooLargeError extends Error {}

/**
 * Read a note from a file, or from stdin for `-`, stopping once it's past
 * MAX_NOTE_BYTES so a large file or an endless stream (`/dev/zero`, a
 * forgotten `tail -f`) can't fill memory before tm-core refuses it.
 */
async function readNoteSource(file: string): Promise<string> {
	const stream =
		file === '-'
			? process.stdin
			: fs.createReadStream(file, { highWaterMark: 64 * 1024 });
	const chunks: Buffer[] = [];
	let size = 0;
	try {
		for await (const chunk of stream) {
			const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
			size += buffer.length;
			// Some slack for the blank lines around a note that get trimmed
			if (size > MAX_NOTE_BYTES + 1024) throw new NoteTooLargeError();
			chunks.push(buffer);
		}
	} finally {
		if (stream !== process.stdin) (stream as fs.ReadStream).destroy();
	}
	return Buffer.concat(chunks).toString('utf8');
}

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
				text = await readNoteSource(options.file);
			} catch (error: any) {
				if (error instanceof NoteTooLargeError) {
					printError(
						`The note is over ${MAX_NOTE_BYTES / 1024} KB`,
						'Keep the note to what you did or decided, and link to the rest'
					);
				} else {
					printError(
						`Couldn't read ${options.file}: ${error.code ?? error.message}`,
						'Check the path, or pipe the note in with `--file -`'
					);
				}
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
