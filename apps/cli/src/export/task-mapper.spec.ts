import { describe, expect, it } from 'vitest';
import { getDisplayPriority } from './task-mapper.js';

describe('getDisplayPriority', () => {
	// Plain ASCII plus the basic arrows block (U+2190-2193), which common
	// terminal fonts all include. Rarer arrows render as missing-glyph boxes.
	const SAFE_LABEL = /^[←-↓A-Za-z ]+$/;

	it.each(['low', 'medium', 'high', 'urgent'])(
		'uses only widely supported glyphs for %s',
		(priority) => {
			expect(getDisplayPriority(priority)).toMatch(SAFE_LABEL);
		}
	);

	it('tells urgent apart from high', () => {
		expect(getDisplayPriority('urgent')).not.toBe(getDisplayPriority('high'));
	});
});
