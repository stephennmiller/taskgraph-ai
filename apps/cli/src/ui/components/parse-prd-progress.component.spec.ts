import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import {
	completedTaskCount,
	formatDuration,
	formatElapsed,
	ParsePrdProgress
} from './parse-prd-progress.component.js';

// biome-ignore lint/suspicious/noControlCharactersInRegex: strip ANSI colors
const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');

/** A non-TTY stream that remembers what was written */
function capture() {
	const stream = new PassThrough() as unknown as NodeJS.WriteStream;
	let out = '';
	stream.write = ((chunk: string) => {
		out += chunk;
		return true;
	}) as NodeJS.WriteStream['write'];
	return { stream, lines: () => plain(out).split('\n').filter(Boolean) };
}

describe('completedTaskCount', () => {
	it('holds back the last task while it may still be growing', () => {
		expect(completedTaskCount(undefined)).toBe(0);
		expect(completedTaskCount({ tasks: [] })).toBe(0);
		expect(completedTaskCount({ tasks: [{ title: 'A' }] })).toBe(0);
		expect(completedTaskCount({ tasks: [{}, {}, {}] })).toBe(2);
	});

	it('counts every task once the stream has finished', () => {
		expect(completedTaskCount({ tasks: [{}, {}, {}] }, true)).toBe(3);
	});
});

describe('formatElapsed', () => {
	it('shows minutes and zero-padded seconds', () => {
		expect(formatElapsed(0)).toBe('0:00');
		expect(formatElapsed(7_900)).toBe('0:07');
		expect(formatElapsed(92_000)).toBe('1:32');
		expect(formatElapsed(-5)).toBe('0:00');
	});
});

describe('formatDuration', () => {
	it('reads naturally in a sentence', () => {
		expect(formatDuration(43_400)).toBe('43s');
		expect(formatDuration(87_000)).toBe('1m 27s');
		expect(formatDuration(120_000)).toBe('2m');
	});
});

describe('ParsePrdProgress', () => {
	let progress: ParsePrdProgress | undefined;
	afterEach(() => progress?.stop());

	it('prints each task once, numbered from startId, as soon as it is complete', () => {
		const { stream, lines } = capture();
		let now = 0;
		progress = new ParsePrdProgress({
			prdName: 'prd.md',
			numTasks: 3,
			startId: 7,
			stream,
			now: () => now
		}).start();

		progress.update({ tasks: [{ title: 'Scaffold' }] });
		progress.update({ tasks: [{ title: 'Scaffold' }, { title: 'Sche' }] });
		progress.update({ tasks: [{ title: 'Scaffold' }, { title: 'Schema' }] });
		now = 48_000;
		progress.succeed({
			tasks: [{ title: 'Scaffold' }, { title: 'Schema' }, { title: 'Search' }]
		});

		expect(lines()).toEqual([
			'Reading prd.md and planning 3 tasks  0:00',
			'✓ 7  Scaffold',
			'✓ 8  Schema',
			'✓ 9  Search',
			'✓ 3 tasks in 48s'
		]);
		expect(progress.printedCount).toBe(3);
	});

	it('says "planning tasks" when the model picks the count', () => {
		const { stream, lines } = capture();
		progress = new ParsePrdProgress({ prdName: 'spec.txt', stream }).start();
		progress.succeed({ tasks: [{ title: 'Only one' }] });
		expect(lines()[0]).toMatch(/^Reading spec\.txt and planning tasks/);
		expect(lines().at(-1)).toMatch(/^✓ 1 task in /);
	});

	it('says when research is on while the model reads', () => {
		const { stream, lines } = capture();
		progress = new ParsePrdProgress({
			prdName: 'prd.md',
			numTasks: 2,
			research: true,
			stream,
			now: () => 0
		}).start();
		expect(lines()[0]).toBe(
			'Reading prd.md and planning 2 tasks with research  0:00'
		);
	});

	it('shortens long titles to one line', () => {
		const { stream, lines } = capture();
		progress = new ParsePrdProgress({ prdName: 'prd.md', stream }).start();
		progress.succeed({
			tasks: [{ title: `A\nvery ${'long '.repeat(30)}title` }]
		});
		const line = lines()[1];
		expect(line).toMatch(/^✓ 1 {2}A very long/);
		expect(line.endsWith('…')).toBe(true);
		expect(line.length).toBeLessThanOrEqual(80);
	});

	it('fits task lines to a narrow terminal', () => {
		const { stream, lines } = capture();
		Object.assign(stream, { columns: 50 });
		progress = new ParsePrdProgress({ prdName: 'prd.md', stream }).start();
		progress.succeed({ tasks: [{ title: 'word '.repeat(40) }] });
		expect(lines()[1].length).toBeLessThanOrEqual(50);
	});

	it('ends with ✗ and the message on failure', () => {
		const { stream, lines } = capture();
		progress = new ParsePrdProgress({ prdName: 'prd.md', stream }).start();
		progress.fail('Claude Code is not signed in');
		expect(lines().at(-1)).toBe('✗ Claude Code is not signed in');
	});
});
