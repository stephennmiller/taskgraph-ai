/**
 * @fileoverview The number of subtasks `expand --num` asks for.
 */

import {
	ERROR_CODES,
	TaskGraphError
} from '../../../common/errors/taskgraph-error.js';
import type { ExpandOptions } from './expand-task.service.js';

/** `num` as a count, undefined when not given; anything but 0 or more is refused */
export function explicitCount(num: ExpandOptions['num']): number | undefined {
	if (num === undefined || num === null || String(num).trim() === '') {
		return undefined;
	}
	if (!/^\d+$/.test(String(num).trim())) {
		throw new TaskGraphError(
			`${JSON.stringify(String(num))} isn't a number of subtasks; use 0 or more`,
			ERROR_CODES.VALIDATION_ERROR
		);
	}
	return Number(String(num).trim());
}
