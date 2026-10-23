import { describe, expect, it } from 'vitest';
import {
	formatMergeConflicts,
	formatMergeDriverSetup,
	formatMergeRenumbered
} from './merge-driver-formatters.js';

const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');

const TASKS_FILE = '.taskgraph/tasks/tasks.json';

describe('formatMergeRenumbered', () => {
	it('prints nothing when nothing was renumbered', () => {
		expect(formatMergeRenumbered([])).toBe('');
	});

	it('says what moved in one line, naming tags other than master', () => {
		const output = plain(
			formatMergeRenumbered(
				[
					{ tag: 'master', from: '3', to: '5' },
					{ tag: 'master', from: '1.2', to: '1.4' },
					{ tag: 'feature', from: '2', to: '3' },
					{ tag: 'feature', from: '4', to: '6' }
				],
				true,
				100
			)
		);

		expect(output).toBe(
			'✓ Merged tasks.json; renumbered incoming 3 → 5, 1.2 → 1.4 · feature: 2 → 3, 4 → 6'
		);
	});

	it('cuts a long list to the width with a count of the rest', () => {
		const rows = Array.from({ length: 30 }, (_, i) => ({
			tag: 'master',
			from: String(i + 10),
			to: String(i + 50)
		}));

		const output = plain(formatMergeRenumbered(rows, true, 80));

		expect(output.length).toBeLessThanOrEqual(80);
		expect(output).toMatch(
			/^✓ Merged tasks\.json; renumbered incoming 10 → 50, /
		);
		expect(output).toMatch(/, \+\d+ more$/);
	});

	it('is a plain note when the merge also conflicted', () => {
		const output = plain(
			formatMergeRenumbered([{ tag: 'master', from: '6', to: '7' }], false, 80)
		);

		expect(output).toBe('Renumbered incoming 6 → 7');
	});
});

describe('formatMergeConflicts', () => {
	it('lists each clash with both values, then the fix', () => {
		const output = plain(
			formatMergeConflicts(
				[
					{
						tag: 'master',
						id: '3',
						field: 'status',
						kind: 'changed-both',
						ours: 'review',
						theirs: 'done'
					},
					{
						tag: 'master',
						id: '3.1',
						field: 'title',
						kind: 'changed-both',
						ours: 'Ours',
						theirs: 'Theirs'
					},
					{
						tag: 'feature',
						id: '7',
						field: '',
						kind: 'removed-ours',
						ours: undefined,
						theirs: {}
					}
				],
				TASKS_FILE,
				[{ tag: 'master', from: '6', to: '7' }],
				80
			)
		);

		expect(output.split('\n')).toEqual([
			"✗ 3 changes to tasks.json clash; kept this branch's values",
			'  3          status  review · incoming: done',
			'  3.1        title   Ours · incoming: Theirs',
			'  feature 7  removed here, changed on the incoming branch; kept it',
			'Renumbered incoming 6 → 7',
			`Edit ${TASKS_FILE} to choose, then git add it`
		]);
	});

	it('says one change in the singular and cuts long values to the width', () => {
		const output = plain(
			formatMergeConflicts(
				[
					{
						tag: 'master',
						id: '12',
						field: 'details',
						kind: 'changed-both',
						ours: 'x'.repeat(200),
						theirs: 'y'.repeat(200)
					}
				],
				TASKS_FILE,
				[],
				80
			)
		);

		const lines = output.split('\n');
		expect(lines[0]).toBe(
			"✗ 1 change to tasks.json clashes; kept this branch's value"
		);
		for (const line of lines) expect(line.length).toBeLessThanOrEqual(80);
		expect(lines[1].endsWith('…')).toBe(true);
	});

	it('labels tag-level clashes by tag', () => {
		const output = plain(
			formatMergeConflicts(
				[
					{
						tag: 'sprint',
						field: 'metadata.description',
						kind: 'changed-both',
						ours: 'A',
						theirs: 'B'
					}
				],
				TASKS_FILE,
				[],
				80
			)
		);

		expect(output.split('\n')[1]).toBe(
			'  tag sprint  metadata.description  A · incoming: B'
		);
	});
});

describe('formatMergeDriverSetup', () => {
	it('lists what it changed', () => {
		const output = plain(
			formatMergeDriverSetup({ attributes: 'created', config: 'set' })
		);

		expect(output.split('\n')).toEqual([
			'✓ Git now merges tasks.json by task',
			'  .gitattributes  routes tasks.json to the driver; commit it',
			'  .git/config     turns it on here; each clone runs init --merge-driver'
		]);
	});

	it('says so in one line when it was already set up', () => {
		expect(
			formatMergeDriverSetup({ attributes: 'unchanged', config: 'unchanged' })
		).toBe('The tasks.json merge driver is already set up');
	});
});
