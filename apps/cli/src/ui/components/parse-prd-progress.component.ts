/**
 * @fileoverview Live progress while `parse-prd` generates tasks.
 *
 * The model streams the task list. Each task is printed the moment it is
 * complete, and the spinner says what is happening now with an elapsed clock:
 *
 *   ✓ 1  Set up project scaffolding
 *   ✓ 2  Design the SQLite schema
 *   ⠼ Writing task 3 of 6 · Implement `bm add`  0:31
 *
 * No percentage or ETA: the model's pace is too uneven to predict honestly.
 */

import chalk from 'chalk';
import type { Ora } from 'ora';
import { terminalWidth } from '../layout/helpers.js';
import { createSpinner } from '../spinner.js';
import { theme } from '../theme.js';

/** What a streamed partial object can look like at any moment */
export interface PartialTaskList {
	tasks?: Array<{ title?: string } | undefined>;
}

export interface ParsePrdProgressOptions {
	/** File name shown while the model reads, e.g. "prd.md" */
	prdName: string;
	/** Tasks asked for; omit or 0 when the model decides */
	numTasks?: number;
	/** ID the first new task will get, so printed IDs match `taskgraph list` */
	startId?: number;
	/** Whether research mode is on; the reading line says so */
	research?: boolean;
	/** Where to write; defaults to stdout */
	stream?: NodeJS.WriteStream;
	/** Clock, for tests */
	now?: () => number;
}

/**
 * Tasks whose content is final. While streaming, the last task in the list
 * may still be growing, so it only counts once another starts or the stream
 * ends.
 */
export function completedTaskCount(
	partial: PartialTaskList | undefined,
	finished = false
): number {
	const count = partial?.tasks?.length ?? 0;
	return finished ? count : Math.max(0, count - 1);
}

/** 0:07, 1:32, 12:05 */
export function formatElapsed(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	const minutes = Math.floor(total / 60);
	const seconds = String(total % 60).padStart(2, '0');
	return `${minutes}:${seconds}`;
}

/** For sentences: 43s, 1m 27s */
export function formatDuration(ms: number): string {
	const total = Math.max(0, Math.round(ms / 1000));
	const minutes = Math.floor(total / 60);
	const seconds = total % 60;
	if (minutes === 0) return `${seconds}s`;
	return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function clip(text: string, max: number): string {
	const clean = text.replace(/\s+/g, ' ').trim();
	return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

export class ParsePrdProgress {
	private readonly options: Required<
		Omit<ParsePrdProgressOptions, 'numTasks'>
	> & { numTasks: number };
	private spinner?: Ora;
	private ticker?: NodeJS.Timeout;
	private startedAt = 0;
	private printed = 0;
	private current: PartialTaskList | undefined;
	private readonly interactive: boolean;

	constructor(options: ParsePrdProgressOptions) {
		this.options = {
			numTasks: options.numTasks || 0,
			startId: options.startId ?? 1,
			research: options.research ?? false,
			stream: options.stream ?? process.stdout,
			now: options.now ?? Date.now,
			prdName: options.prdName
		};
		this.interactive = Boolean(this.options.stream.isTTY);
	}

	start(): this {
		this.startedAt = this.options.now();
		if (this.interactive) {
			this.spinner = createSpinner({
				text: this.statusText(),
				stream: this.options.stream
			}).start();
			this.ticker = setInterval(() => this.refresh(), 1000);
			this.ticker.unref?.();
		} else {
			this.write(`${this.statusText()}\n`);
		}
		return this;
	}

	/** Feed each partial object from the stream */
	update(partial: PartialTaskList | undefined): void {
		this.current = partial;
		this.printCompleted(completedTaskCount(partial));
		this.refresh();
	}

	/** The stream ended; print whatever is left and the total */
	succeed(final?: PartialTaskList): void {
		if (final) this.current = final;
		this.printCompleted(completedTaskCount(this.current, true));
		const n = this.printed;
		const took = formatDuration(this.options.now() - this.startedAt);
		const message = `${n} ${n === 1 ? 'task' : 'tasks'} in ${took}`;
		this.stop();
		this.write(`${chalk.green('✓')} ${chalk.bold(message)}\n`);
	}

	fail(message: string): void {
		this.stop();
		this.write(`${chalk.red('✗')} ${message}\n`);
	}

	/**
	 * Stop without a closing line, e.g. before falling back to a slower path.
	 * Tasks already printed stay on screen.
	 */
	stop(): void {
		if (this.ticker) clearInterval(this.ticker);
		this.ticker = undefined;
		this.spinner?.stop();
		this.spinner = undefined;
	}

	/** Number of tasks printed so far */
	get printedCount(): number {
		return this.printed;
	}

	private printCompleted(upTo: number): void {
		const tasks = this.current?.tasks ?? [];
		while (this.printed < upTo) {
			const task = tasks[this.printed];
			const id = this.options.startId + this.printed;
			// "✓ 12 " is 6 columns; keep each task on one line
			const title = clip(task?.title ?? '', Math.max(20, this.columns - 7));
			this.persist(
				`${chalk.green('✓')} ${theme.brand(String(id).padEnd(3))}${title}`
			);
			this.printed++;
		}
	}

	private persist(line: string): void {
		if (this.spinner) {
			this.spinner.clear();
			this.write(`${line}\n`);
			this.spinner.render();
		} else {
			this.write(`${line}\n`);
		}
	}

	private refresh(): void {
		if (this.spinner) this.spinner.text = this.statusText();
	}

	private statusText(): string {
		const { numTasks, prdName, research } = this.options;
		const writing = this.current?.tasks?.length ?? 0;
		let text: string;
		if (writing === 0) {
			text = numTasks
				? `Reading ${prdName} and planning ${numTasks} tasks`
				: `Reading ${prdName} and planning tasks`;
			if (research) text += ' with research';
		} else {
			const of = numTasks ? ` of ${numTasks}` : '';
			const title = this.current?.tasks?.[writing - 1]?.title;
			text = `Writing task ${writing}${of}`;
			// Spinner, text, " · ", title, two spaces, clock: one line, never wrapped
			const room = this.columns - 2 - text.length - 3 - 2 - 6;
			if (title && room >= 12) text += theme.muted(` · ${clip(title, room)}`);
		}
		return `${text}  ${theme.muted(this.elapsed())}`;
	}

	private get columns(): number {
		return terminalWidth(this.options.stream);
	}

	private elapsed(): string {
		return formatElapsed(this.options.now() - this.startedAt);
	}

	private write(text: string): void {
		this.options.stream.write(text);
	}
}
