import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
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

	it('names a broken state.json under TASKGRAPH_DEBUG, but not a missing one', () => {
		vi.stubEnv('TASKGRAPH_DEBUG', 'true');
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		expect(takeMigrationNotice(root)).toBe(false);
		expect(warn).not.toHaveBeenCalled();

		fs.writeFileSync(statePath, '{not json');
		expect(takeMigrationNotice(root)).toBe(false);
		expect(warn).toHaveBeenCalledWith(expect.stringContaining(statePath));
	});

	it('still shows the notice when state.json cannot be written', () => {
		vi.stubEnv('TASKGRAPH_DEBUG', 'true');
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const state = { currentTag: 'master', migrationNoticePending: true };
		fs.writeFileSync(statePath, JSON.stringify(state));
		vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
			throw Object.assign(new Error('read-only'), { code: 'EROFS' });
		});

		expect(takeMigrationNotice(root)).toBe(true);
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('EROFS'));
		expect(readState()).toEqual(state);
	});

	it.skipIf(process.platform === 'win32')(
		'leaves a symlinked state.json and its target unchanged',
		() => {
			const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-elsewhere-'));
			const target = path.join(elsewhere, 'state.json');
			const text = JSON.stringify({ migrationNoticePending: true });
			fs.writeFileSync(target, text);
			fs.symlinkSync(target, statePath);
			try {
				takeMigrationNotice(root);
				expect(fs.readFileSync(target, 'utf8')).toBe(text);
			} finally {
				fs.rmSync(elsewhere, { recursive: true, force: true });
			}
		}
	);
});
