/**
 * Brand banner tests
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	displayAsciiBanner,
	displayInitBanner
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

	it('keeps the Hamster line unchanged', () => {
		const output = captureBanner(() =>
			displayAsciiBanner({ version: '1.2.3' })
		);

		expect(output).toContain('tryhamster.com');
	});
});
