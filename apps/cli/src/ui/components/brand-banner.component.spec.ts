/**
 * Brand banner tests
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	displayAsciiBanner,
	displayInitBanner,
	isTopLevelHelpRequest,
	shouldShowAsciiBanner
} from './brand-banner.component.js';

function captureBanner(render: () => void): string {
	const log = vi.spyOn(console, 'log').mockImplementation(() => {});
	render();
	return log.mock.calls.map((call) => call.join(' ')).join('\n');
}

describe('brand banner credits', () => {
	let originalHide: string | undefined;

	beforeEach(() => {
		originalHide = process.env.TM_HIDE_BANNER;
		delete process.env.TM_HIDE_BANNER;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		if (originalHide === undefined) delete process.env.TM_HIDE_BANNER;
		else process.env.TM_HIDE_BANNER = originalHide;
	});

	it('credits the maintainer on the full banner', () => {
		const output = captureBanner(() =>
			displayAsciiBanner({ version: '1.2.3' })
		);

		expect(output).toContain('x.com/stephennmiller_');
		expect(output).not.toContain('eyaltoledano');
	});

	it('credits the maintainer on the init banner', () => {
		const output = captureBanner(() => displayInitBanner());

		expect(output).toContain('x.com/stephennmiller_');
		expect(output).not.toContain('eyaltoledano');
	});

	it('has no Hamster promo line on the full banner', () => {
		const output = captureBanner(() =>
			displayAsciiBanner({ version: '1.2.3' })
		);

		expect(output).not.toContain('tryhamster.com');
		expect(output).not.toContain('TaskGraph for teams');
	});

	it('has no Hamster promo line on the init banner', () => {
		const output = captureBanner(() => displayInitBanner());

		expect(output).not.toContain('tryhamster.com');
		expect(output).not.toContain('TaskGraph for teams');
	});
});

describe('shouldShowAsciiBanner', () => {
	it.each([['--help'], ['-h'], ['help']])(
		'shows the banner for the top-level help screen (%s) in a terminal',
		(arg) => {
			expect(shouldShowAsciiBanner([arg], true)).toBe(true);
		}
	);

	it('shows the banner for bare taskgraph in a terminal', () => {
		expect(shouldShowAsciiBanner([], true)).toBe(true);
	});

	it.each([
		[['list']],
		[['show', '2']],
		[['next']],
		[['set-status', '--id=3', '--status=done']],
		[['tags', 'remove', 'backup']],
		[['validate-dependencies']],
		[['add-dependency', '--id=2', '--depends-on=1']],
		[['--version']],
		[['list', '--help']],
		[['init']],
		[['tui']]
	])('leads with the result for %j', (args) => {
		expect(shouldShowAsciiBanner(args, true)).toBe(false);
	});

	it('never shows the banner when stdout is not a terminal', () => {
		expect(shouldShowAsciiBanner(['--help'], false)).toBe(false);
		expect(shouldShowAsciiBanner([], false)).toBe(false);
	});

	it('still honors --no-banner on the help screen', () => {
		expect(shouldShowAsciiBanner(['--help', '--no-banner'], true)).toBe(false);
	});
});

describe('isTopLevelHelpRequest', () => {
	it.each([
		[['--help']],
		[['-h']],
		[['help']],
		[['--help', '--no-banner']],
		[['--no-banner', '-h']]
	])('is the top-level help screen for %j', (args) => {
		expect(isTopLevelHelpRequest(args)).toBe(true);
	});

	it.each([
		[[]],
		[['--no-banner']],
		[['list', '--help']],
		[['--help', 'list']],
		[['--version']],
		[['next']]
	])('is not for %j', (args) => {
		expect(isTopLevelHelpRequest(args)).toBe(false);
	});
});
