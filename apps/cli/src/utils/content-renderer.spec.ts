import { describe, expect, it } from 'vitest';
import { renderContent } from './content-renderer.js';

describe('renderContent', () => {
	it('drops terminal escape sequences from task text before rendering', () => {
		// A title change (OSC 0), a bell and a clear-screen (CSI 2J)
		const details = 'Use JWT\u001b]0;pwned\u0007 tokens\u001b[2J';

		const output = renderContent(details);

		expect(output).not.toMatch(/\u001b\]|\u0007|\u001b\[2J/);
		expect(output).toContain('Use JWT tokens');
	});
});
