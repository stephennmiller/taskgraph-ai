/**
 * @fileoverview The one-line parallel-waves summary under `taskgraph graph`:
 *
 *   3 waves · 4 tasks can run now: 2, 3, 4, 9
 *
 * and, when some open tasks can't be scheduled (a loop, a missing
 * dependency, or held in review, blocked or deferred):
 *
 *   2 waves · 1 task can run now: 5 · 3 can't be scheduled
 *
 * The waves themselves come from tm-core's parallelWaves.
 */

import type { ParallelWaves } from '@tm/core';
import { theme } from '../theme.js';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Format the waves summary, fitted to `width` (IDs that don't fit end in
 * "…", the first is always kept). Returns null when there's no unfinished work to summarize.
 */
export function formatWaveSummary(
	waves: ParallelWaves,
	width = 80
): string | null {
	const ready = waves.waves[0] ?? [];
	const stuck = waves.unscheduled.length;
	if (!ready.length && !stuck) return null;

	const head = ready.length
		? `${plural(waves.waves.length, 'wave')} · ${plural(ready.length, 'task')} can run now`
		: 'Nothing can run now';
	const tail = stuck ? ` · ${stuck} can't be scheduled` : '';
	if (!ready.length) return theme.muted(head + tail);

	const room = width - head.length - tail.length - 2;
	let ids = ready.join(', ');
	if (ids.length > room) {
		// Always name the first task, so the line keeps a next step even
		// when it is too narrow for more
		const kept = [ready[0]];
		for (const id of ready.slice(1)) {
			if ([...kept, id].join(', ').length + 3 > room) break;
			kept.push(id);
		}
		ids = kept.length < ready.length ? `${kept.join(', ')}, …` : kept[0];
	}
	return `${theme.muted(`${head}:`)} ${ids}${theme.muted(tail)}`;
}
