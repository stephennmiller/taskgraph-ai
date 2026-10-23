import { describe, expect, it } from 'vitest';
import {
	CURRENT_SCHEMA_VERSION,
	stampTasksFileSchemaVersion
} from './schema-version.js';

describe('stampTasksFileSchemaVersion', () => {
	it('stamps every tag of a tagged file and keeps its other metadata', () => {
		const data = {
			master: { tasks: [], metadata: { created: '2020-01-01' } },
			feature: { tasks: [{ id: 1 }] }
		};

		stampTasksFileSchemaVersion(data);

		expect(data.master.metadata).toEqual({
			created: '2020-01-01',
			schemaVersion: CURRENT_SCHEMA_VERSION
		});
		expect(data.feature).toEqual({
			tasks: [{ id: 1 }],
			metadata: { schemaVersion: CURRENT_SCHEMA_VERSION }
		});
	});

	it('never lowers a newer version already recorded on a tag', () => {
		const newer = CURRENT_SCHEMA_VERSION + 1;
		const data = { master: { tasks: [], metadata: { schemaVersion: newer } } };

		stampTasksFileSchemaVersion(data);

		expect(data.master.metadata.schemaVersion).toBe(newer);
	});

	it('replaces a malformed version with the current one', () => {
		const data = { master: { tasks: [], metadata: { schemaVersion: 'x' } } };

		stampTasksFileSchemaVersion(data);

		expect(data.master.metadata.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
	});

	it('stamps a single-tag file with tasks at the root', () => {
		const data = { tasks: [], metadata: { created: '2020-01-01' } };

		stampTasksFileSchemaVersion(data);

		expect(data.metadata).toEqual({
			created: '2020-01-01',
			schemaVersion: CURRENT_SCHEMA_VERSION
		});
	});

	it('stamps the tags of a file that also has root tasks, as it is read as tagged', () => {
		const data = {
			tasks: [],
			metadata: {},
			master: { tasks: [], metadata: { created: '2020-01-01' } }
		};

		stampTasksFileSchemaVersion(data);

		expect(data.master.metadata).toEqual({
			created: '2020-01-01',
			schemaVersion: CURRENT_SCHEMA_VERSION
		});
	});

	it('leaves metadata that is not a plain object unchanged', () => {
		const data = {
			master: { tasks: [], metadata: ['x'] },
			feature: { tasks: [], metadata: 'notes' }
		};

		stampTasksFileSchemaVersion(data);

		expect(data.master.metadata).toEqual(['x']);
		expect(data.feature.metadata).toBe('notes');
	});

	it('leaves keys that are not tags, and files with no tasks, unchanged', () => {
		const data = {
			master: { tasks: [] },
			notes: { text: 'hi' },
			list: [{ tasks: [] }]
		};
		const state = { currentTag: 'master' };

		stampTasksFileSchemaVersion(data);
		stampTasksFileSchemaVersion(state);

		expect(data.notes).toEqual({ text: 'hi' });
		expect(data.list).toEqual([{ tasks: [] }]);
		expect(state).toEqual({ currentTag: 'master' });
		expect(stampTasksFileSchemaVersion(null)).toBeNull();
	});
});
