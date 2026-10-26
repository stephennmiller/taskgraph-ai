/**
 * @fileoverview Unit tests for RuntimeStateManager service, on a temp project
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG_VALUES } from '../../../common/interfaces/configuration.interface.js';
import { recordBranchTag } from '../../tasks/utils/branch-tag.js';
import { RuntimeStateManager } from './runtime-state-manager.service.js';

const DEFAULT_TAG = DEFAULT_CONFIG_VALUES.TAGS.DEFAULT_TAG;

describe('RuntimeStateManager', () => {
	let root: string;
	let statePath: string;
	let stateManager: RuntimeStateManager;

	const writeState = (content: unknown) => {
		fs.mkdirSync(path.dirname(statePath), { recursive: true });
		fs.writeFileSync(
			statePath,
			typeof content === 'string' ? content : JSON.stringify(content)
		);
	};
	const readRaw = () => fs.readFileSync(statePath, 'utf-8');
	const readState = () => JSON.parse(readRaw());

	beforeEach(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-state-'));
		statePath = path.join(root, '.taskgraph', 'state.json');
		stateManager = new RuntimeStateManager(root, {});
	});

	afterEach(() => {
		fs.rmSync(root, { recursive: true, force: true });
	});

	describe('loadState', () => {
		it('should load state from file', async () => {
			writeState({
				activeTag: 'feature-branch',
				lastUpdated: '2024-01-01T00:00:00.000Z',
				metadata: { test: 'data' }
			});

			const state = await stateManager.loadState();

			expect(state.currentTag).toBe('feature-branch');
			expect(state.metadata).toEqual({ test: 'data' });
		});

		it('should override with environment variable if set', async () => {
			writeState({ activeTag: 'file-tag' });
			stateManager = new RuntimeStateManager(root, {
				TASKGRAPH_TAG: 'env-tag'
			});

			const state = await stateManager.loadState();

			expect(state.currentTag).toBe('env-tag');
		});

		it('should use default state when file does not exist', async () => {
			const state = await stateManager.loadState();

			expect(state.currentTag).toBe(DEFAULT_TAG);
		});

		it('should use environment variable when file does not exist', async () => {
			stateManager = new RuntimeStateManager(root, {
				TASKGRAPH_TAG: 'env-tag'
			});

			const state = await stateManager.loadState();

			expect(state.currentTag).toBe('env-tag');
		});

		it('should handle file read errors gracefully', async () => {
			fs.mkdirSync(statePath, { recursive: true });

			const state = await stateManager.loadState();

			expect(state.currentTag).toBe(DEFAULT_TAG);
		});

		it('should handle invalid JSON gracefully', async () => {
			writeState('invalid json');

			const state = await stateManager.loadState();

			expect(state.currentTag).toBe(DEFAULT_TAG);
		});
	});

	describe('saveState', () => {
		it('should save state to file with timestamp', async () => {
			await stateManager.setCurrentTag('test-tag');

			expect(readState()).toMatchObject({
				currentTag: 'test-tag',
				lastUpdated: expect.any(String)
			});
		});

		it('should keep keys it does not manage, such as branchTagMapping', async () => {
			writeState({
				currentTag: 'master',
				branchTagMapping: { 'feature/x': 'feature-x' },
				migrationNoticeShown: true
			});

			await stateManager.loadState();
			await stateManager.setCurrentTag('feature-x');

			expect(readState()).toMatchObject({
				currentTag: 'feature-x',
				branchTagMapping: { 'feature/x': 'feature-x' },
				migrationNoticeShown: true
			});
		});

		it('should keep existing metadata when saving without loadState', async () => {
			writeState({ currentTag: 'master', metadata: { a: 1 } });

			await stateManager.setCurrentTag('feature-x');

			expect(readState()).toMatchObject({
				currentTag: 'feature-x',
				metadata: { a: 1 }
			});
		});

		it('keeps every branch mapping written while tag switches run at once', async () => {
			writeState({ currentTag: 'master', branchTagMapping: {} });
			const branches = ['a', 'b', 'c', 'd', 'e'];

			await Promise.all([
				...branches.map((b) => recordBranchTag(root, b, `tag-${b}`)),
				...branches.map((b) => stateManager.setCurrentTag(`tag-${b}`))
			]);

			expect(Object.keys(readState().branchTagMapping).sort()).toEqual(
				branches
			);
		});

		it('should throw TaskGraphError on save failure', async () => {
			// A file where the .taskgraph directory should be
			fs.writeFileSync(path.join(root, '.taskgraph'), '');

			await expect(stateManager.saveState()).rejects.toThrow(
				'Failed to save runtime state'
			);
		});

		it('should format JSON with proper indentation', async () => {
			await stateManager.saveState();

			expect(readRaw()).toMatch(/\n {2}"/);
		});
	});

	describe('getActiveTag', () => {
		it('should return current active tag', () => {
			expect(stateManager.getCurrentTag()).toBe(DEFAULT_TAG);
		});

		it('should return updated tag after setActiveTag', async () => {
			await stateManager.setCurrentTag('new-tag');

			expect(stateManager.getCurrentTag()).toBe('new-tag');
		});
	});

	describe('getState', () => {
		it('should return copy of current state', () => {
			const state1 = stateManager.getState();
			const state2 = stateManager.getState();

			expect(state1).not.toBe(state2);
			expect(state1).toEqual(state2);
			expect(state1.currentTag).toBe(DEFAULT_TAG);
		});
	});

	describe('updateMetadata', () => {
		it('should update metadata and save state', async () => {
			await stateManager.updateMetadata({ key1: 'value1' });

			expect(stateManager.getState().metadata).toEqual({ key1: 'value1' });
			expect(readState().metadata).toEqual({ key1: 'value1' });
		});

		it('should merge metadata with existing values', async () => {
			await stateManager.updateMetadata({ key1: 'value1' });
			await stateManager.updateMetadata({ key2: 'value2' });

			expect(stateManager.getState().metadata).toEqual({
				key1: 'value1',
				key2: 'value2'
			});
		});

		it('should override existing metadata values', async () => {
			await stateManager.updateMetadata({ key1: 'value1' });
			await stateManager.updateMetadata({ key1: 'value2' });

			expect(stateManager.getState().metadata).toEqual({ key1: 'value2' });
		});
	});

	describe('clearState', () => {
		it('should delete state file and reset to defaults', async () => {
			await stateManager.updateMetadata({ key1: 'value1' });

			await stateManager.clearState();

			expect(fs.existsSync(statePath)).toBe(false);
			expect(stateManager.getCurrentTag()).toBe(DEFAULT_TAG);
			expect(stateManager.getState().metadata).toBeUndefined();
		});

		it('should ignore ENOENT errors when file does not exist', async () => {
			await expect(stateManager.clearState()).resolves.not.toThrow();
			expect(stateManager.getCurrentTag()).toBe(DEFAULT_TAG);
		});

		it('should throw other errors', async () => {
			fs.mkdirSync(statePath, { recursive: true });

			await expect(stateManager.clearState()).rejects.toThrow();
		});
	});
});
