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

	it('shows the tag and the tasks.json it reads from', () => {
		displayCommandHeader({ tag: 'feature-x' });

		const text = output.join('\n');
		expect(text).toContain('feature-x');
		expect(text).toContain('.taskgraph/tasks/tasks.json');
	});

	it('falls back to the master tag', () => {
		displayCommandHeader({});

		expect(output.join('\n')).toContain('master');
	});
});
