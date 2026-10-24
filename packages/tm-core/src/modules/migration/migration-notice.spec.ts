import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { takeMigrationNotice } from './migration-notice.js';

describe('takeMigrationNotice', () => {
	let root: string;
	let statePath: string;
	const readState = () => JSON.parse(fs.readFileSync(statePath, 'utf8'));

	beforeEach(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-migration-notice-'));
		fs.mkdirSync(path.join(root, '.taskgraph'));
		statePath = path.join(root, '.taskgraph', 'state.json');
	});

	afterEach(() => {
		fs.rmSync(root, { recursive: true, force: true });
	});

	it('is due once after a migration, then marked shown', () => {
		fs.writeFileSync(
			statePath,
			JSON.stringify({ currentTag: 'master', migrationNoticePending: true })
		);

		expect(takeMigrationNotice(root)).toBe(true);
		expect(readState()).toEqual({
			currentTag: 'master',
			migrationNoticePending: false,
			migrationNoticeShown: true
		});
		expect(takeMigrationNotice(root)).toBe(false);
	});

	it('is not due for a new project that has never shown it', () => {
		const state = { currentTag: 'master', migrationNoticeShown: false };
		fs.writeFileSync(statePath, JSON.stringify(state));

		expect(takeMigrationNotice(root)).toBe(false);
		expect(readState()).toEqual(state);
	});

	it('is not due without a state.json or with a broken one', () => {
		expect(takeMigrationNotice(root)).toBe(false);

		fs.writeFileSync(statePath, '{not json');
		expect(takeMigrationNotice(root)).toBe(false);
	});
});
