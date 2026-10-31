import { Writable } from 'node:stream';
import { Chalk } from 'chalk';
import { stripVTControlCharacters as stripAnsi } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

	it('finishes with the CLI’s own ✓ and ✗ symbols', () => {
		let written = '';
		const stream = new Writable({
			write(chunk, _enc, done) {
				written += chunk.toString();
				done();
			}
		});

		createSpinner({ text: 'Parsing', stream }).succeed('Done');
		createSpinner({ text: 'Parsing', stream }).fail('Broke');

		expect(written).toContain('✓ Done');
		expect(written).toContain('✗ Broke');
		expect(written).not.toContain('✔');
	});
});

describe('createSpinner elapsed time (#881)', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	function ttyStream() {
		let written = '';
		const stream = Object.assign(
			new Writable({
				write(chunk, _enc, done) {
					written += chunk.toString();
					done();
				}
			}),
			{
				isTTY: true,
				columns: 80,
				cursorTo: () => true,
				moveCursor: () => true,
				clearLine: () => true
			}
		);
		return { stream, output: () => written };
	}

	it('adds seconds once the wait passes 3s, and stops the clock on fail', () => {
		vi.useFakeTimers();
		const { stream, output } = ttyStream();
		const spinner = createSpinner({ text: 'Writing', stream, isEnabled: true });

		spinner.start();
		vi.advanceTimersByTime(2000);
		expect(spinner.suffixText).toBe('');
		vi.advanceTimersByTime(10_000);
		expect(stripAnsi(String(spinner.suffixText))).toBe('12s');

		spinner.fail('Broke');

		expect(vi.getTimerCount()).toBe(0);
		expect(stripAnsi(output())).toContain('✗ Broke\n');
		expect(stripAnsi(output())).not.toContain('✗ Broke 12s');
	});

	it('leaves the text alone with elapsed: false', () => {
		vi.useFakeTimers();
		const { stream } = ttyStream();
		const spinner = createSpinner({
			text: 'Parsing  0:12',
			stream,
			isEnabled: true,
			elapsed: false
		}).start();

		vi.advanceTimersByTime(12_000);

		expect(spinner.suffixText).toBe('');
		spinner.stop();
	});

	it('prints the plain start line once off a terminal', () => {
		vi.useFakeTimers();
		const { stream, output } = ttyStream();
		createSpinner({ text: 'Writing', stream, isEnabled: false }).start();

		vi.advanceTimersByTime(12_000);

		expect(vi.getTimerCount()).toBe(0);
		expect(output()).toBe('- Writing\n');
	});
});
