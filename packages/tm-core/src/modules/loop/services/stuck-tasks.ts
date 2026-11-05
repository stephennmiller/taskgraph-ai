/**
 * @fileoverview The tasks a loop run set to blocked because they were stuck,
 * so it could go on with the next ready one (#997)
 */

import type { SetAsideTask } from '../types.js';
import { CLAUDE_MISSING, DOCKER_MISSING } from './iteration-limits.js';
import type { LoopServiceOptions } from './loop-service-options.js';

/** The note a stuck task gets: its errors in a row, or the sessions it made no progress in */
const stuckReason = (errors: number, stalled: number, error?: string) =>
	error === undefined
		? `stuck: no progress in ${stalled} sessions`
		: `stuck: ${errors} failed sessions in a row. Last error: ${error}`;

/** Why a run that can't set its stuck task aside stops */
export const stalledMessage = (id: string | undefined, stalled: number) =>
	`${id ? `Task ${id} is stuck: no` : 'No'} task changed status and nothing was committed in ${stalled} iterations in a row. Check the progress file and the task, then run loop again.`;

export class StuckTasks {
	/** `error` is the one that stuck the task, to spot a broken setup */
	private readonly list: (SetAsideTask & { error?: string })[] = [];

	constructor(
		private readonly block: LoopServiceOptions['blockTask'],
		private readonly readyTask: () => Promise<string | undefined>,
		private readonly warn: (message: string) => void,
		private readonly tag?: string
	) {}

	/**
	 * A failed iteration's error means the setup is broken, not the task:
	 * Claude or Docker is missing, or the next task also failed `inARow` times
	 * with the error that set one aside. Most errors are generic (`Exit code 1`,
	 * a timeout), so one repeat alone doesn't count.
	 */
	brokenSetup(error: string | undefined, inARow: boolean): boolean {
		return (
			error === CLAUDE_MISSING ||
			error === DOCKER_MISSING ||
			(inARow &&
				error !== undefined &&
				this.list.some((t) => t.error === error))
		);
	}

	/**
	 * Block the task `next` picks, with the reason as a note.
	 * @returns The task it set aside and the next ready one; neither when it
	 *   can't (no lookup, a pinned run, or the write failed)
	 */
	async setAside(
		errors: number,
		stalled: number,
		error?: string
	): Promise<{ aside?: string; ready?: string }> {
		const id = this.block && (await this.readyTask());
		if (!this.block || !id) return {};
		const reason = stuckReason(errors, stalled, error);
		try {
			await this.block(id, reason, this.tag);
		} catch (e) {
			this.warn(
				`Couldn't set task ${id} aside: ${e instanceof Error ? e.message : String(e)}`
			);
			return {};
		}
		this.list.push({ id, reason, error });
		const ready = await this.readyTask();
		if (ready) {
			this.warn(
				`Task ${id} is ${reason}. Set it to blocked; continuing with task ${ready}.`
			);
		}
		return { aside: id, ready };
	}

	/** What the run's result lists, or undefined when it set nothing aside */
	get tasks(): SetAsideTask[] | undefined {
		return this.list.length
			? this.list.map(({ id, reason }) => ({ id, reason }))
			: undefined;
	}
}
