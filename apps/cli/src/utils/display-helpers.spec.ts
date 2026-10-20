import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { displayCommandHeader } from './display-helpers.js';

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
	});

	it('shows the tag on one line, like the legacy commands, without a path', () => {
		displayCommandHeader({ tag: 'feature-x' });

		const text = output.join('\n').replace(/\u001b\[[0-9;]*m/g, '');
		expect(text).toBe('[tag] feature-x');
	});

	it('falls back to the master tag', () => {
		displayCommandHeader({});

		expect(output.join('\n')).toContain('master');
	});
});
