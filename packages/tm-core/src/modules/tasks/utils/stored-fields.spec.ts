import { describe, expect, it } from 'vitest';
import { keepStoredFields } from './stored-fields.js';

describe('keepStoredFields', () => {
	it('copies stored fields the rewrite leaves out', () => {
		const stored = {
			id: 1,
			title: 'Old',
			github: { issue: 12 },
			tags: ['api'],
			acceptanceCriteria: [{ text: 'Login works', checked: true }],
			definitionOfDoneChecked: ['Tests pass']
		};
		const rewrite: Record<string, unknown> = { id: 1, title: 'New' };

		keepStoredFields(rewrite, stored);

		expect(rewrite).toEqual({ ...stored, title: 'New' });
	});

	it('keeps what the rewrite sets, null included', () => {
		const rewrite = { id: 1, details: null };

		keepStoredFields(rewrite, { id: 1, details: 'stored' });

		expect(rewrite).toEqual({ id: 1, details: null });
	});

	it('leaves the rewrite alone when nothing was stored', () => {
		const rewrite = { id: 1, title: 'New' };

		keepStoredFields(rewrite, undefined);
		keepStoredFields(rewrite, {});

		expect(rewrite).toEqual({ id: 1, title: 'New' });
	});
});
