import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	readTagNamesSync,
	shouldShowTagIndicator,
	shouldShowTagIndicatorForProject
} from './tag-indicator.js';

describe('shouldShowTagIndicator', () => {
	it('hides the line in a project that only has master', () => {
		expect(shouldShowTagIndicator('master', ['master'])).toBe(false);
	});

	it('hides the line when the tasks file has no tags yet', () => {
		expect(shouldShowTagIndicator('master', [])).toBe(false);
	});

	it('shows the line on any tag other than master', () => {
		expect(shouldShowTagIndicator('feature-auth', ['feature-auth'])).toBe(
			true
		);
	});

	it('shows the line on master once the project has another tag', () => {
		expect(shouldShowTagIndicator('master', ['master', 'feature-auth'])).toBe(
			true
		);
	});

	it('counts a repeated tag name once', () => {
		expect(shouldShowTagIndicator('master', ['master', 'master'])).toBe(false);
	});
});

describe('reading tags from tasks.json', () => {
	let dir: string;
	const tasksPath = () => path.join(dir, '.taskgraph', 'tasks', 'tasks.json');
	const writeTasks = (data: unknown) => {
		fs.mkdirSync(path.dirname(tasksPath()), { recursive: true });
		fs.writeFileSync(tasksPath(), JSON.stringify(data));
	};

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-tag-indicator-'));
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it('lists every tag key of a tagged file', () => {
		writeTasks({ master: { tasks: [] }, 'feature-auth': { tasks: [] } });

		expect(readTagNamesSync(tasksPath())).toEqual(['master', 'feature-auth']);
	});

	it('treats an untagged file as master', () => {
		writeTasks({ tasks: [], metadata: {} });

		expect(readTagNamesSync(tasksPath())).toEqual(['master']);
	});

	it('returns no tags when the file is missing or not JSON', () => {
		expect(readTagNamesSync(tasksPath())).toEqual([]);

		fs.mkdirSync(path.dirname(tasksPath()), { recursive: true });
		fs.writeFileSync(tasksPath(), '{ not json');
		expect(readTagNamesSync(tasksPath())).toEqual([]);
	});

	it('decides from the project tasks file', () => {
		writeTasks({ master: { tasks: [] } });
		expect(shouldShowTagIndicatorForProject('master', dir)).toBe(false);

		writeTasks({ master: { tasks: [] }, 'feature-auth': { tasks: [] } });
		expect(shouldShowTagIndicatorForProject('master', dir)).toBe(true);
	});

	it('shows a non-master tag without reading the file', () => {
		expect(shouldShowTagIndicatorForProject('feature-auth', dir)).toBe(true);
	});
});
