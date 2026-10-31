import { describe, expect, it } from 'vitest';
import { normalizeAssignee } from './assignee.js';

describe('normalizeAssignee', () => {
	it('stores a login lowercase, without a leading @', () => {
		expect(normalizeAssignee(' @OctoCat ')).toBe('octocat');
		expect(normalizeAssignee('dev_acme')).toBe('dev_acme');
	});

	it('reads an empty value as clearing the assignee', () => {
		expect(normalizeAssignee('')).toBeNull();
		expect(normalizeAssignee('  ')).toBeNull();
	});

	it('refuses what cannot be a login, with a hint', () => {
		for (const bad of ['a b', '-lead', 'x/y', 'a;rm']) {
			expect(() => normalizeAssignee(bad)).toThrow(/isn't a GitHub login/);
		}
	});
});
