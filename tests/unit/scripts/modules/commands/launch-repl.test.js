import { vi } from 'vitest';

// Load ui.js first: commands.js -> @tm/cli -> ... -> ui.js -> @tm/cli is an
// import cycle that Vitest only resolves when ui.js is the entry point.
import '../../../../../scripts/modules/ui.js';

// `react` is not a declared dependency, so it must never be imported while the
// TUI is still a "coming soon" placeholder (regression test for #1725).
vi.doMock(
	'react',
	() => {
		throw new Error("Cannot find package 'react'");
	},
	{ virtual: true }
);

const { launchREPL } = await import(
	'../../../../../scripts/modules/commands.js'
);

describe('launchREPL', () => {
	let logSpy;

	beforeEach(() => {
		logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
	});

	afterEach(() => {
		logSpy.mockRestore();
	});

	it('shows the placeholder and help without importing react', async () => {
		await expect(launchREPL()).resolves.toBeUndefined();

		const output = logSpy.mock.calls.map((args) => args.join(' ')).join('\n');
		expect(output).toContain('TUI mode coming soon!');
	});
});
