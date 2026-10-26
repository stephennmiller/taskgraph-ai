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
			tasks: [{ id: '1' }],
			metadata: { schemaVersion: CURRENT_SCHEMA_VERSION }
		});
	});

	it('stores task and subtask IDs and dependencies as strings, as FileStorage does (#392, #748)', () => {
		const task = {
			id: 2,
			dependencies: [1, '3.1'],
			subtasks: [{ id: 1, dependencies: [2, '3'] }]
		};
		const data = { master: { tasks: [task] } };

		stampTasksFileSchemaVersion(data);

		expect(data.master.tasks).toEqual([
			{
				id: '2',
				dependencies: ['1', '3.1'],
				// On a subtask a bare number is a sibling, so it keeps its type
				subtasks: [{ id: '1', dependencies: [2, '3'] }]
			}
		]);
		// The caller's task object is not changed
		expect(task.id).toBe(2);
		expect(task.dependencies).toEqual([1, '3.1']);
		expect(task.subtasks[0].id).toBe(1);
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

	it('stamps a null-prototype file whose tags are named __proto__ or constructor', () => {
		const data = Object.create(null);
		Object.defineProperty(data, '__proto__', {
			value: { tasks: [], metadata: { created: 'c' } },
			enumerable: true,
			writable: true,
			configurable: true
		});
		data.constructor = { tasks: [] };

		stampTasksFileSchemaVersion(data);

		expect(Object.getPrototypeOf(data)).toBeNull();
		expect(JSON.parse(JSON.stringify(data))).toEqual(
			JSON.parse(
				`{"__proto__":{"tasks":[],"metadata":{"created":"c","schemaVersion":${CURRENT_SCHEMA_VERSION}}},"constructor":{"tasks":[],"metadata":{"schemaVersion":${CURRENT_SCHEMA_VERSION}}}}`
			)
		);
	});

	it('does not read a schemaVersion inherited by the metadata object', () => {
		const metadata = Object.create({ schemaVersion: 7 });
		const data = { master: { tasks: [], metadata } };

		stampTasksFileSchemaVersion(data);

		expect(data.master.metadata).toEqual({
			schemaVersion: CURRENT_SCHEMA_VERSION
		});
	});
});
