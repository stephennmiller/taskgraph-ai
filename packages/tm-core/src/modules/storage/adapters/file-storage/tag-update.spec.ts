import { describe, expect, it } from 'vitest';
import type { Task } from '../../../../common/types/index.js';
import { FormatHandler } from './format-handler.js';
import { applyTagUpdate, buildTagMetadata } from './tag-update.js';

const task = { id: '1', title: 'A', status: 'pending' } as unknown as Task;
const prdSections = { 'docs/prd.md': { overview: 'abc' } };

describe('applyTagUpdate', () => {
	it('keeps metadata other writers stored on the tag', () => {
		const existing = {
			master: {
				tasks: [],
				metadata: { created: '2025-01-01', taskCount: 0, prdSections }
			},
			feature: { tasks: [], metadata: {} }
		};

		const saved = applyTagUpdate(
			new FormatHandler(),
			existing,
			'master',
			[task],
			buildTagMetadata([task], 'master')
		);

		expect(saved.master.metadata).toMatchObject({
			created: '2025-01-01',
			taskCount: 1,
			prdSections
		});
	});

	it('keeps them in the single-tag format too', () => {
		const saved = applyTagUpdate(
			new FormatHandler(),
			{ tasks: [], metadata: { prdSections } },
			'master',
			[task],
			buildTagMetadata([task], 'master')
		);

		expect(saved.metadata).toMatchObject({ taskCount: 1, prdSections });
	});
});
