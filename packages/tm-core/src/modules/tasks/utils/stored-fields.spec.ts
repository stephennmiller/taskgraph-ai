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

	it('fills fields the rewrite set to null and keeps the ones it set', () => {
		const rewrite = { id: 1, title: 'New', details: null };

		keepStoredFields(rewrite, { id: 1, title: 'Old', details: 'stored' });

		expect(rewrite).toEqual({ id: 1, title: 'New', details: 'stored' });
	});

	it('drops a null for a field the stored one lacks', () => {
		const rewrite = { id: 1, title: 'New', subtasks: null, details: null };

		keepStoredFields(rewrite, { id: 1, title: 'Old' });

		expect(rewrite).toEqual({ id: 1, title: 'New' });
	});

	it("keeps loop's stored spend whatever the rewrite says", () => {
		const spend = { usd: 1.5, durationMs: 9000, iterations: 2 };
		const forged = { id: 1, title: 'New', spend: { usd: 0 } };
		const cleared = { id: 1, title: 'New', spend: null };
		const added = { id: 1, title: 'New', spend: { usd: 0 } };

		keepStoredFields(forged, { id: 1, title: 'Old', spend });
		keepStoredFields(cleared, { id: 1, title: 'Old', spend });
		keepStoredFields(added, { id: 1, title: 'Old' });

		expect(forged.spend).toBe(spend);
		expect(cleared.spend).toBe(spend);
		expect(added).not.toHaveProperty('spend');
	});

	it('leaves the rewrite alone when nothing was stored', () => {
		const rewrite = { id: 1, title: 'New' };

		keepStoredFields(rewrite, undefined);
		keepStoredFields(rewrite, {});

		expect(rewrite).toEqual({ id: 1, title: 'New' });
	});
});
