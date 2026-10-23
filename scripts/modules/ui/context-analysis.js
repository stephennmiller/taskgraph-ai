import { ui } from '@tm/cli';
import { isSilentMode } from '../utils.js';
import { theme } from './theme.js';

export function displayAiUsageSummary(telemetryData, outputType = 'cli') {
	if (
		(outputType !== 'cli' && outputType !== 'text') ||
		!telemetryData ||
		isSilentMode()
	) {
		return; // Only display for CLI and if data exists and not in silent mode
	}

	// One quiet line instead of a 9-line box: the command, provider and a
	// $0.000000 cost told people nothing new
	const line = ui.formatUsageLine(telemetryData);
	if (line) {
		console.log(`\n${theme.muted(line)}`);
	}
}

/**
 * Confirm the subtasks `expand` just added, one line each
 * @param {number|string} parentId - The expanded task
 * @param {Array<{id: number|string, title: string}>} subtasks - The new subtasks only
 */
export function displayAddedSubtasks(parentId, subtasks) {
	if (isSilentMode() || !subtasks?.length) return;
	console.log(`\n${ui.formatAddedSubtasks(parentId, subtasks)}`);
}
