import { describe, expect, it } from 'vitest';
import { parseChangelogHighlights } from './changelog.js';

describe('parseChangelogHighlights', () => {
	const changelog = `
## 1.0.0

### Minor Changes

- [#123](https://example.com) Thanks [@user](https://example.com)! - Test feature
		`;

	it('reads the highlights of a version', () => {
		expect(parseChangelogHighlights(changelog, '1.0.0')).toEqual([
			'Test feature'
		]);
		expect(parseChangelogHighlights(changelog, '1.0.0-rc.1')).toEqual([]);
	});

	it('returns nothing for a malformed version (ReDoS protection)', () => {
		expect(parseChangelogHighlights(changelog, 'invalid')).toEqual([]);
		expect(parseChangelogHighlights(changelog, '1.0')).toEqual([]);
		expect(parseChangelogHighlights(changelog, 'a.b.c')).toEqual([]);
		expect(
			parseChangelogHighlights(changelog, '((((((((((((((((((((((((((((((a')
		).toEqual([]);
	});
});
