/**
 * @fileoverview tasks.parsePrd with `stream` (the terminal's live list) and
 * tasks.findPrdGaps (`--clarify`). Only the AI call is mocked.
 */

import * as fs from 'node:fs';
import { APICallError, streamObject as sdkStreamObject } from 'ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiService } from '../../../src/modules/ai/ai-service.js';
import {
	type PrdProject,
	createPrdProject,
	generated,
	reply
} from './parse-prd-fixture.js';

// The SDK call, for the test that goes through the real AiService and provider
vi.mock('ai', async (importOriginal) => {
	const actual = await importOriginal<typeof import('ai')>();
	return { ...actual, streamObject: vi.fn(actual.streamObject) };
});

/** A streamObject result: its partial lists, then `object` (or its failure) */
function streamed(
	tasks: object[],
	{ object, usage }: { object?: Promise<unknown>; usage?: object } = {}
) {
	const partials = tasks.map((_, i) => ({ tasks: tasks.slice(0, i + 1) }));
	return {
		...reply(),
		mainResult: {
			partialObjectStream: (async function* () {
				yield* partials;
			})(),
			object: object ?? Promise.resolve({ tasks }),
			usage: Promise.resolve(usage ?? { inputTokens: 100, outputTokens: 50 })
		}
	};
}

const refused = () =>
	new APICallError({
		message: 'model not found',
		url: 'x',
		requestBodyValues: {}
	});

describe('tasks.parsePrd streaming', () => {
	let p: PrdProject;
	const parse = (hooks = {}) =>
		p.tmCore.tasks.parsePrd({ prdPath: p.prdPath, stream: true }, hooks);

	beforeEach(async () => {
		p = await createPrdProject();
	});
	afterEach(() => p.close());

	it('reports each partial list and the usage from the finished stream', async () => {
		const tasks = [generated(1), generated(2)];
		p.streamObject.mockResolvedValue(streamed(tasks) as any);
		vi.spyOn(AiService.prototype, 'logUsage').mockImplementation(
			async (usage) => ({ ...usage, rebuilt: true }) as any
		);
		const onAiCall = vi.fn();
		const onPartial = vi.fn();
		const onGenerated = vi.fn();

		const result = await parse({ onAiCall, onPartial, onGenerated });

		expect(onAiCall).toHaveBeenCalledWith({
			numTasks: 0,
			startId: 1,
			streaming: true
		});
		expect(onPartial).toHaveBeenCalledTimes(2);
		expect(onGenerated).toHaveBeenCalledWith(tasks, true);
		expect(result.telemetryData).toMatchObject({
			inputTokens: 100,
			outputTokens: 50,
			rebuilt: true
		});
		expect(p.generateObject).not.toHaveBeenCalled();
		expect(p.read().master.tasks).toHaveLength(2);
	});

	it('keeps the first copy when the reply repeats the JSON', async () => {
		const tasks = [generated(1)];
		const text = JSON.stringify({ tasks }).repeat(2);
		const object = Promise.reject(
			Object.assign(new Error('bad JSON'), { text })
		);
		// Read only after the partials; mark it handled until then
		object.catch(() => {});
		p.streamObject.mockResolvedValue(streamed(tasks, { object }) as any);

		await parse();

		expect(p.read().master.tasks.map((t: any) => t.title)).toEqual(['New 1']);
		expect(p.generateObject).not.toHaveBeenCalled();
	});

	it('falls back to one request when the stream fails', async () => {
		p.streamObject.mockRejectedValue(new Error('stream broke'));
		const onStreamFailed = vi.fn();
		const onAiCall = vi.fn();

		await parse({ onStreamFailed, onAiCall });

		expect(onStreamFailed).toHaveBeenCalledWith(expect.any(Error), true);
		expect(onAiCall).toHaveBeenLastCalledWith(
			expect.objectContaining({ streaming: false })
		);
		expect(p.generateObject).toHaveBeenCalledTimes(1);
	});

	it('does not ask again when the provider refuses and every role uses the same model', async () => {
		p.streamObject.mockRejectedValue(refused());
		const onStreamFailed = vi.fn();

		await expect(parse({ onStreamFailed })).rejects.toThrow('model not found');

		expect(onStreamFailed).toHaveBeenCalledWith(expect.any(Error), false);
		expect(p.generateObject).not.toHaveBeenCalled();
	});

	it('does not ask again when the refusal comes wrapped by AiService and the provider (#588)', async () => {
		p.streamObject.mockRestore();
		vi.mocked(sdkStreamObject).mockImplementationOnce(() => {
			throw refused();
		});
		const onStreamFailed = vi.fn();

		await expect(parse({ onStreamFailed })).rejects.toThrow('model not found');

		expect(sdkStreamObject).toHaveBeenCalledTimes(1);
		expect(onStreamFailed).toHaveBeenCalledWith(expect.any(Error), false);
		expect(p.generateObject).not.toHaveBeenCalled();
	});

	it('tries the one request when a fallback role uses another model', async () => {
		await p.close();
		p = await createPrdProject({
			models: { fallback: { provider: 'claude-code', modelId: 'opus' } }
		});
		p.streamObject.mockRejectedValue(refused());

		await parse();

		expect(p.generateObject).toHaveBeenCalledTimes(1);
	});
});

describe('tasks.findPrdGaps', () => {
	let p: PrdProject;
	beforeEach(async () => {
		p = await createPrdProject();
	});
	afterEach(() => p.close());

	it('returns the questions the PRD does not answer yet, without writing anything', async () => {
		fs.appendFileSync(
			p.prdPath,
			'\n## Clarifications\n\n- **Q:** Which database?\n  **A:** SQLite\n'
		);
		const before = fs.readFileSync(p.tasksPath, 'utf8');
		p.generateObject.mockResolvedValue({
			...reply(),
			mainResult: {
				object: {
					questions: [
						{ question: 'Which database?', suggestedAnswer: 'Postgres' },
						{ question: 'How do users sign in?', suggestedAnswer: 'Email' }
					]
				}
			}
		} as any);

		const result = await p.tmCore.tasks.findPrdGaps({
			prdPath: p.prdPath,
			research: true
		});

		expect(result.questions).toEqual([
			{ question: 'How do users sign in?', suggestedAnswer: 'Email' }
		]);
		expect(p.generateObject.mock.calls[0][0]).toMatchObject({
			role: 'research',
			objectName: 'clarifying_questions',
			commandName: 'parse-prd'
		});
		expect(fs.readFileSync(p.tasksPath, 'utf8')).toBe(before);
	});

	it('fails on a reply without questions', async () => {
		p.generateObject.mockResolvedValue({ ...reply(), mainResult: {} } as any);

		await expect(
			p.tmCore.tasks.findPrdGaps({ prdPath: p.prdPath })
		).rejects.toThrow('AI service returned unexpected data for the questions');
	});
});
