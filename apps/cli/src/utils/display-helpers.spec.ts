import { stripVTControlCharacters as plain } from 'node:util';
import { shouldShowTagIndicatorForProject } from '@tm/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { displayCommandHeader } from './display-helpers.js';

vi.mock('@tm/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tm/core')>()),
	shouldShowTagIndicatorForProject: vi.fn()
}));

const shouldShow = vi.mocked(shouldShowTagIndicatorForProject);

describe('displayCommandHeader', () => {
	let output: string[];

	beforeEach(() => {
		output = [];
		vi.spyOn(console, 'log').mockImplementation((line?: unknown) => {
			output.push(String(line));
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		shouldShow.mockReset();
	});

	it('shows the tag on one line, without a path, when core says it matters', () => {
		shouldShow.mockReturnValue(true);

		const shown = displayCommandHeader({ tag: 'feature-x', projectRoot: '/p' });

		expect(output.map(plain)).toEqual(['[tag] feature-x']);
		expect(shown).toBe(true);
		expect(shouldShow).toHaveBeenCalledWith('feature-x', '/p');
	});

	it('prints nothing when core says the tag line tells you nothing', () => {
		shouldShow.mockReturnValue(false);

		const shown = displayCommandHeader({ tag: 'master', projectRoot: '/p' });

		expect(output).toEqual([]);
		expect(shown).toBe(false);
	});

	it('falls back to master', () => {
		shouldShow.mockReturnValue(true);

		displayCommandHeader({ projectRoot: '/p' });

		expect(shouldShow).toHaveBeenCalledWith('master', '/p');
		expect(output.map(plain)).toEqual(['[tag] master']);
	});
});
