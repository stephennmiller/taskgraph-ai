/**
 * @fileoverview getProjectPaths: which project `tags` and the tag indicator use
 */

import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getProjectPaths } from './path-helpers.js';

describe('getProjectPaths', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('uses TASKGRAPH_PROJECT_ROOT when no path is given', () => {
		const main = path.resolve('/projects/main');
		vi.stubEnv('TASKGRAPH_PROJECT_ROOT', main);

		expect(getProjectPaths()).toEqual({
			projectRoot: main,
			tasksPath: path.join(main, '.taskgraph', 'tasks', 'tasks.json')
		});
	});

	it('takes an explicit path over TASKGRAPH_PROJECT_ROOT', () => {
		vi.stubEnv('TASKGRAPH_PROJECT_ROOT', path.resolve('/projects/main'));

		expect(getProjectPaths('/projects/other').projectRoot).toBe(
			path.resolve('/projects/other')
		);
	});
});
