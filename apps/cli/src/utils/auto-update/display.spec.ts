import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { displayUpgradeNotification } from './display.js';

describe('displayUpgradeNotification', () => {
	let log: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		log = vi.spyOn(console, 'log').mockImplementation(() => {});
	});

	afterEach(() => {
		log.mockRestore();
	});

	it('names the new and the installed version', () => {
		displayUpgradeNotification('1.0.0', '1.1.0');

		expect(log).toHaveBeenCalledTimes(1);
		expect(log.mock.calls[0][0]).toContain('1.1.0 is out');
		expect(log.mock.calls[0][0]).toContain('you have 1.0.0');
	});

	it('lists the highlights, without a box', () => {
		const highlights = [
			'Add Codex CLI provider with OAuth authentication',
			'Cursor IDE custom slash command support',
			'Move to AI SDK v5'
		];

		displayUpgradeNotification('1.0.0', '1.1.0', highlights);

		const output = log.mock.calls[0][0];
		expect(output).toContain('1.1.0 is out');
		for (const highlight of highlights) {
			expect(output).toContain(`• ${highlight}`);
		}
		expect(output).not.toMatch(/[╭╮╰╯│]/);
	});
});
