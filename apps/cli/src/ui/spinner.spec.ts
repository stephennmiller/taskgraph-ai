import { Chalk } from 'chalk';
import { describe, expect, it } from 'vitest';
import { brandSpinner, createSpinner } from './spinner.js';

describe('brandSpinner', () => {
	it('paints every frame in the brand accent on truecolor terminals', () => {
		const paint = new Chalk({ level: 3 }).hex('#0096C7');

		const { frames, interval } = brandSpinner(paint);

		expect(interval).toBe(80);
		expect(frames).toHaveLength(10);
		for (const frame of frames) {
			expect(frame).toContain('\u001b[38;2;0;150;199m');
		}
	});

	it('falls back to ANSI cyan on 16-color terminals', () => {
		const paint = new Chalk({ level: 1 }).hex('#0096C7');

		const { frames } = brandSpinner(paint);

		expect(frames[0]).toBe('\u001b[36m⠋\u001b[39m');
	});

	it('leaves frames plain when color is off', () => {
		const paint = new Chalk({ level: 0 }).hex('#0096C7');

		expect(brandSpinner(paint).frames[0]).toBe('⠋');
	});
});

describe('createSpinner', () => {
	it('accepts plain text and disables ora’s own color', () => {
		const spinner = createSpinner('Parsing PRD...');

		expect(spinner.text).toBe('Parsing PRD...');
		expect(spinner.color).toBe(false);
	});
});
