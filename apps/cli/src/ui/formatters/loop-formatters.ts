/**
 * @fileoverview What `taskgraph loop` prints before its first iteration:
 *
 *   Loop · tdd preset · 1 iteration · Claude CLI
 *   Task 3  Set up the database schema
 */

import type { LoopTask } from '@tm/core';
import chalk from 'chalk';
import { theme } from '../theme.js';
import { fit } from './parallel-loop-formatters.js';

export interface LoopIntro {
	/** Preset name or custom prompt path */
	prompt: string;
	/** Whether `prompt` is a built-in preset */
	isPreset: boolean;
	iterations: number;
	sandbox: boolean;
	/** The task `--id` pinned */
	pinned?: LoopTask;
	/**
	 * The task `taskgraph next` would pick, for presets that work on tasks:
	 * null when none is ready, undefined for presets that pick their own work
	 */
	next?: LoopTask | null;
}

/** The lines `loop` prints before it starts Claude */
export function formatLoopIntro(intro: LoopIntro, width = 80): string[] {
	const prompt = intro.isPreset
		? `${intro.prompt} preset`
		: `prompt ${intro.prompt}`;
	const iterations =
		intro.iterations === 1
			? '1 iteration'
			: `up to ${intro.iterations} iterations`;
	const mode = intro.sandbox ? 'Docker sandbox' : 'Claude CLI';
	const facts = fit([prompt, iterations, mode].join(' · '), width - 7);
	const lines = [theme.text('Loop') + theme.muted(` · ${facts}`)];

	const task = intro.pinned ?? intro.next;
	if (task) {
		const label = intro.pinned ? 'Task' : 'Starts with task';
		const head = `${label} ${fit(task.id, 20)}  `;
		lines.push(theme.text(head + fit(task.title, width - head.length)));
	} else if (intro.next === null) {
		lines.push(chalk.yellow('No task is ready to work on'));
	}
	return lines;
}
