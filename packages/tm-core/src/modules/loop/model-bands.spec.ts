/**
 * @fileoverview Picking an iteration's model and effort from the task's
 * complexity score (#838)
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	DEFAULT_LOOP_BANDS,
	defaultLoopEffort,
	modelArgs,
	parseLoopModel,
	pickModelEffort,
	resolveLoopBands
} from './model-bands.js';

describe('pickModelEffort', () => {
	it.each([
		[1, { model: 'sonnet', effort: 'low' }],
		[3, { model: 'sonnet', effort: 'low' }],
		[4, {}],
		[6, {}],
		[7, { effort: 'high' }],
		[10, { effort: 'high' }]
	])('puts score %d in its default band', (score, choice) => {
		expect(pickModelEffort(score, DEFAULT_LOOP_BANDS)).toEqual(choice);
	});

	it.each([undefined, null, 'complex', Number.NaN, 11])(
		"leaves Claude Code's defaults for a task without a usable score (%s)",
		(score) => {
			expect(pickModelEffort(score, DEFAULT_LOOP_BANDS)).toEqual({});
		}
	);

	it('picks nothing when there are no bands', () => {
		expect(pickModelEffort(2, [])).toEqual({});
	});

	it("lets --model replace the band's model but keeps its effort", () => {
		expect(pickModelEffort(2, DEFAULT_LOOP_BANDS, 'opus')).toEqual({
			model: 'opus',
			effort: 'low'
		});
		expect(pickModelEffort(9, DEFAULT_LOOP_BANDS, 'opus')).toEqual({
			model: 'opus',
			effort: 'high'
		});
		expect(pickModelEffort(undefined, DEFAULT_LOOP_BANDS, 'opus')).toEqual({
			model: 'opus'
		});
	});

	it('fills in the default effort where no band picks one', () => {
		expect(pickModelEffort(5, DEFAULT_LOOP_BANDS, undefined, 'low')).toEqual({
			effort: 'low'
		});
		expect(pickModelEffort(undefined, [], 'opus', 'low')).toEqual({
			model: 'opus',
			effort: 'low'
		});
		expect(pickModelEffort(9, DEFAULT_LOOP_BANDS, undefined, 'low')).toEqual({
			effort: 'high'
		});
	});
});

describe('defaultLoopEffort', () => {
	let root: string;
	let home: string;
	const env = (extra: NodeJS.ProcessEnv = {}) => ({
		CLAUDE_CONFIG_DIR: home,
		...extra
	});

	beforeEach(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-effort-'));
		home = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-claude-'));
	});

	afterEach(() => {
		fs.rmSync(root, { recursive: true, force: true });
		fs.rmSync(home, { recursive: true, force: true });
	});

	const write = (file: string, json: string) => {
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, json);
	};

	it('is low when you chose no effort', () => {
		expect(defaultLoopEffort(root, env())).toBe('low');
	});

	it('is none when CLAUDE_CODE_EFFORT_LEVEL is set', () => {
		expect(
			defaultLoopEffort(root, env({ CLAUDE_CODE_EFFORT_LEVEL: 'high' }))
		).toBeUndefined();
	});

	it.each([
		['user', () => path.join(home, 'settings.json')],
		['project', () => path.join(root, '.claude', 'settings.json')],
		['local project', () => path.join(root, '.claude', 'settings.local.json')]
	])('is none when your %s settings set effortLevel', (_, file) => {
		write(file(), '{"effortLevel": "medium"}');

		expect(defaultLoopEffort(root, env())).toBeUndefined();
	});

	it("is low when a settings file can't be read or sets no effort", () => {
		write(path.join(root, '.claude', 'settings.json'), '{ not json');
		write(path.join(home, 'settings.json'), '{"model": "opus"}');

		expect(defaultLoopEffort(root, env())).toBe('low');
	});
});

describe('modelArgs', () => {
	it('turns a choice into claude flags', () => {
		expect(modelArgs({ model: 'sonnet', effort: 'low' })).toEqual([
			'--model',
			'sonnet',
			'--effort',
			'low'
		]);
		expect(modelArgs({})).toEqual([]);
	});
});

describe('resolveLoopBands', () => {
	it('uses the defaults when the config sets no bands', () => {
		expect(resolveLoopBands(undefined)).toBe(DEFAULT_LOOP_BANDS);
		expect(resolveLoopBands({})).toBe(DEFAULT_LOOP_BANDS);
	});

	it('takes the configured bands, sorted by maxScore', () => {
		expect(
			resolveLoopBands({
				bands: [
					{ maxScore: 10, model: 'opus', effort: 'max' },
					{ maxScore: 5, model: 'claude-haiku-4-5' }
				]
			})
		).toEqual([
			{ maxScore: 5, model: 'claude-haiku-4-5' },
			{ maxScore: 10, model: 'opus', effort: 'max' }
		]);
		expect(resolveLoopBands({ bands: [] })).toEqual([]);
	});

	it.each([
		[{ bands: 'fast' }, 'must be a list'],
		[
			{ bands: [{ model: 'opus' }] },
			'band 1 needs a whole number from 1 to 10 for maxScore'
		],
		[{ bands: [{ maxScore: 3, model: '--help' }] }, "isn't a model name"],
		[{ bands: [{ maxScore: 3, effort: 'huge' }] }, 'effort "huge"'],
		[{ bands: [{ maxScore: 0 }] }, 'band 1 needs a whole number from 1 to 10'],
		[{ bands: [{ maxScore: 3 }, { maxScore: 11 }] }, 'band 2 needs a whole'],
		[{ bands: [{ maxScore: 3.5 }] }, 'band 1 needs a whole'],
		[
			{ bands: [{ maxScore: 6 }, { maxScore: 6, model: 'opus' }] },
			'two bands have maxScore 6'
		],
		[{ bands: [null] }, 'band 1 needs']
	])('refuses %j', (loop, message) => {
		expect(() => resolveLoopBands(loop)).toThrow(message);
	});
});

describe('parseLoopModel', () => {
	it('takes aliases and full model names', () => {
		expect(parseLoopModel(' opus ')).toBe('opus');
		expect(parseLoopModel('claude-opus-4-5[1m]')).toBe('claude-opus-4-5[1m]');
		expect(parseLoopModel(undefined)).toBeUndefined();
	});

	it.each(['', '--dangerously-skip-permissions', 'opus; rm -rf /'])(
		'refuses %j',
		(value) => {
			expect(() => parseLoopModel(value)).toThrow('--model');
		}
	);
});
