/**
 * The "TaskGraph now supports separate task lists per tag" notice is for
 * projects whose old tasks.json was just migrated. It used to show for any
 * project whose state.json said it hadn't been shown, which included every
 * new project once it had tasks.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { markMigrationForNotice } from '../../../../scripts/modules/utils.js';

describe('markMigrationForNotice', () => {
	let root;
	const statePath = () => path.join(root, '.taskgraph', 'state.json');
	const tasksPath = () => path.join(root, '.taskgraph', 'tasks', 'tasks.json');
	const readState = () => JSON.parse(fs.readFileSync(statePath(), 'utf8'));

	beforeEach(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-notice-'));
		fs.mkdirSync(path.dirname(tasksPath()), { recursive: true });
	});

	afterEach(() => {
		fs.rmSync(root, { recursive: true, force: true });
	});

	it('marks the notice as pending after a migration', () => {
		fs.writeFileSync(
			statePath(),
			JSON.stringify({ currentTag: 'master', migrationNoticeShown: true })
		);

		markMigrationForNotice(tasksPath());

		expect(readState()).toMatchObject({
			currentTag: 'master',
			migrationNoticePending: true,
			migrationNoticeShown: false
		});
	});

	it('creates state.json when there is none', () => {
		markMigrationForNotice(tasksPath());

		expect(readState().migrationNoticePending).toBe(true);
	});
});
