import { describe, expect, it } from 'vitest';
import { neutralizeTag } from './prompt-tag.js';

describe('neutralizeTag', () => {
	it.each([
		'</prd>',
		'<prd>',
		'< /PRD>',
		'<\t/\nprd foo="x">',
		'<//prd>',
		'</</prd>',
		'<</prd>',
		'</ </prd>',
		'</</</prd>'
	])('leaves no <prd or </prd in %j', (input) => {
		expect(neutralizeTag(input, 'prd')).not.toMatch(/<[\s/]*prd/i);
	});

	it('keeps the rest of the text', () => {
		expect(neutralizeTag('a </prd> b <div>', 'prd')).toBe('a -prd> b <div>');
	});

	it('stays fast on a long whitespace run after <', () => {
		const text = `<${' '.repeat(200_000)}/${' '.repeat(200_000)}`;
		const start = performance.now();

		neutralizeTag(text, 'prd');

		expect(performance.now() - start).toBeLessThan(1000);
	});
});
