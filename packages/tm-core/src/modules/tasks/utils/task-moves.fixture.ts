/** Tasks for the move specs, as older files store them */

import type { Task } from '../../../common/types/index.js';

// Tasks as older files store them: numeric IDs and dependencies
export const sample = (): Task[] =>
	[
		{ id: 1, title: 'Set up', status: 'done', dependencies: [], subtasks: [] },
		{
			id: 2,
			title: 'Parser',
			status: 'pending',
			dependencies: [1],
			subtasks: [
				{ id: 1, title: 'Read', status: 'pending', dependencies: [] },
				{ id: 2, title: 'Validate', status: 'pending', dependencies: [1] }
			]
		},
		{
			id: 3,
			title: 'Plugins',
			status: 'pending',
			dependencies: [],
			subtasks: []
		},
		{
			id: 4,
			title: 'Report',
			status: 'pending',
			dependencies: [2, 3],
			subtasks: []
		},
		{
			id: 5,
			title: 'Publish',
			status: 'pending',
			dependencies: [4],
			subtasks: []
		}
	] as unknown as Task[];

export const ids = (tasks: Task[]) => tasks.map((t) => String(t.id));
export const noArchive = new Set<string>();
