import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from './map-with-concurrency.js';

/** A call the test finishes by hand, so it controls the order */
function deferred() {
	let resolve!: (value: string) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<string>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('mapWithConcurrency', () => {
	it('keeps at most limit calls running and starts the next as one ends', async () => {
		const calls = Array.from({ length: 5 }, deferred);
		const started: number[] = [];

		const run = mapWithConcurrency([0, 1, 2, 3, 4], 3, (i) => {
			started.push(i);
			return calls[i].promise;
		});
		await tick();
		expect(started).toEqual([0, 1, 2]);

		calls[1].resolve('b');
		await tick();
		expect(started).toEqual([0, 1, 2, 3]);

		calls[0].resolve('a');
		calls[2].resolve('c');
		calls[3].resolve('d');
		await tick();
		expect(started).toEqual([0, 1, 2, 3, 4]);
		calls[4].resolve('e');

		expect(await run).toEqual(['a', 'b', 'c', 'd', 'e']);
	});

	it('returns results in input order whatever order calls finish in', async () => {
		const result = await mapWithConcurrency([30, 10, 20], 3, async (ms) => {
			await new Promise((resolve) => setTimeout(resolve, ms));
			return ms;
		});

		expect(result).toEqual([30, 10, 20]);
	});

	it('treats a limit below 1 as one call at a time', async () => {
		const calls = Array.from({ length: 2 }, deferred);
		const started: number[] = [];

		const run = mapWithConcurrency([0, 1], 0, (i) => {
			started.push(i);
			return calls[i].promise;
		});
		await tick();
		expect(started).toEqual([0]);

		calls[0].resolve('a');
		await tick();
		calls[1].resolve('b');

		expect(await run).toEqual(['a', 'b']);
	});

	it('returns an empty list for no items', async () => {
		expect(await mapWithConcurrency([], 3, async () => 1)).toEqual([]);
	});

	it('starts no new calls after a rejection and rejects with it', async () => {
		const calls = Array.from({ length: 4 }, deferred);
		const started: number[] = [];

		const run = mapWithConcurrency([0, 1, 2, 3], 2, (i) => {
			started.push(i);
			return calls[i].promise;
		});
		await tick();
		calls[0].reject(new Error('boom'));
		await tick();
		calls[1].resolve('b');

		await expect(run).rejects.toThrow('boom');
		expect(started).toEqual([0, 1]);
	});
});
