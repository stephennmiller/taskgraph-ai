/**
 * @fileoverview A parallel task's log file: opening it safely and reading
 * the run's spend back from it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { findResultEvent, hasStreamEvent } from '../services/stream-events.js';
import type { ParallelTask } from './types.js';

/**
 * Open a task's log for appending. Never through a symlink: one planted
 * there would send Claude's output into whatever file it points at.
 */
export function openLog(file: string): number {
	const flags =
		fs.constants.O_WRONLY |
		fs.constants.O_APPEND |
		fs.constants.O_CREAT |
		(fs.constants.O_NOFOLLOW ?? 0);
	let stat: fs.Stats | undefined;
	try {
		stat = fs.lstatSync(file);
	} catch {
		// A new log
	}
	if (stat && !stat.isFile()) {
		throw new Error(`${path.basename(file)} isn't a plain file`);
	}
	return fs.openSync(file, flags, 0o600);
}

/** The cost and turns at the end of a task's log, if Claude Code got that far */
export function readSpend(task: ParallelTask, from: number): void {
	try {
		// From where this run started: a rerun appends to the failed run's log
		const log = fs.readFileSync(task.logFile).subarray(from);
		const text = log.toString('utf8');
		const run = findResultEvent(text);
		if (run?.costUsd !== undefined) task.costUsd = run.costUsd;
		// Started, then killed or crashed before its result event (#861)
		else if (hasStreamEvent(text)) task.costUnknown = true;
		if (run?.turns !== undefined) task.turns = run.turns;
	} catch {
		// No log (the spawn failed): nothing was spent
	}
}
