import { describe, expect, it } from 'vitest';
import { formatUpdateNotice } from './update-formatters.js';

const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');

describe('formatUpdateNotice', () => {
	it('says which version is out in one line when there are no highlights', () => {
		expect(plain(formatUpdateNotice('1.0.0', '1.1.0', [], 80))).toBe(
			'TaskGraph 1.1.0 is out (you have 1.0.0)'
		);
	});

	it('lists highlights as bullets under the version line', () => {
		const output = plain(
			formatUpdateNotice(
				'1.0.0',
				'1.1.0',
				['Add Codex CLI provider', 'Move to AI SDK v5'],
				80
			)
		);

		expect(output.split('\n')).toEqual([
			'TaskGraph 1.1.0 is out (you have 1.0.0)',
			'  • Add Codex CLI provider',
			'  • Move to AI SDK v5'
		]);
	});

	it.each([80, 40])(
		'wraps long highlights under their text at %i columns',
		(width) => {
			const highlight =
				'Parse PRDs into tasks with a clarifying round first, so the gaps in a product requirements document turn into questions before any task is written';
			const lines = plain(
				formatUpdateNotice('1.0.0', '1.1.0', [highlight], width)
			).split('\n');

			expect(lines.length).toBeGreaterThan(2);
			for (const line of lines) expect(line.length).toBeLessThanOrEqual(width);
			for (const line of lines.slice(2))
				expect(line.startsWith('    ')).toBe(true);
		}
	);
});
