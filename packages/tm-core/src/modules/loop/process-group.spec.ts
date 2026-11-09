import { afterEach, describe, expect, it, vi } from 'vitest';
import { exitOnStopSignals } from './process-group.js';

describe('exitOnStopSignals', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it.each([
		['SIGINT', 130],
		['SIGTERM', 143]
	] as const)(
		'exits with the shell code for %s while the work runs',
		async (sig, code) => {
			const exit = vi
				.spyOn(process, 'exit')
				.mockImplementation(() => undefined as never);
			let finish = () => {};
			const working = exitOnStopSignals(
				() => new Promise<void>((done) => (finish = done))
			);

			process.emit(sig, sig);
			finish();
			await working;

			expect(exit).toHaveBeenCalledWith(code);
		}
	);

	it('stops listening once the work is over, also when it threw', async () => {
		const before = process.listenerCount('SIGTERM');

		await expect(
			exitOnStopSignals(() => Promise.reject(new Error('no')))
		).rejects.toThrow('no');

		expect(process.listenerCount('SIGTERM')).toBe(before);
	});
});
