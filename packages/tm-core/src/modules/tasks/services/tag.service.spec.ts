import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileStorage } from '../../storage/adapters/file-storage/index.js';
import { TagService } from './tag.service.js';

let projectRoot: string;
let tasksPath: string;
let statePath: string;
let currentTag: string;

const task = (id: string, status = 'pending', dependencies: string[] = []) => ({
	id,
	title: `Task ${id}`,
	description: '',
	status,
	priority: 'medium',
	dependencies,
	details: '',
	testStrategy: '',
	subtasks: []
});

function writeTasks(data: unknown) {
	fs.writeFileSync(tasksPath, JSON.stringify(data, null, 2));
}
const readTasks = () => JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
const readState = () => JSON.parse(fs.readFileSync(statePath, 'utf8'));

function service() {
	return new TagService(new FileStorage(projectRoot), {
		projectRoot,
		getActiveTag: () => currentTag
	});
}

beforeEach(() => {
	projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tag-service-'));
	fs.mkdirSync(path.join(projectRoot, '.taskgraph', 'tasks'), {
		recursive: true
	});
	tasksPath = path.join(projectRoot, '.taskgraph', 'tasks', 'tasks.json');
	statePath = path.join(projectRoot, '.taskgraph', 'state.json');
	currentTag = 'master';
	fs.writeFileSync(statePath, JSON.stringify({ currentTag: 'master' }));
	writeTasks({
		master: { tasks: [task('1')], metadata: { description: 'Main' } },
		feature: {
			tasks: [task('1', 'done'), task('2', 'pending', ['1'])],
			metadata: { created: '2026-01-01T00:00:00.000Z', description: 'Feat' }
		}
	});
});

afterEach(() => {
	fs.rmSync(projectRoot, { recursive: true, force: true });
});

describe('TagService.createTag', () => {
	it('creates an empty tag with a default description', async () => {
		const result = await service().createTag('sprint');

		expect(result).toMatchObject({
			tagName: 'sprint',
			tasksCopied: 0,
			sourceTag: null
		});
		expect(readTasks().sprint.tasks).toEqual([]);
		expect(readTasks().sprint.metadata.description).toMatch(/^Tag created on /);
	});

	it('copies the current tag with copyFromCurrent', async () => {
		currentTag = 'feature';

		const result = await service().createTag('copy', {
			copyFromCurrent: true,
			description: 'Mine'
		});

		expect(result).toMatchObject({ tasksCopied: 2, sourceTag: 'feature' });
		const file = readTasks();
		expect(file.copy.tasks).toEqual(file.feature.tasks);
		expect(file.copy.metadata.description).toBe('Mine');
	});

	it('creates an empty tag when the source tag is missing', async () => {
		const result = await service().createTag('empty', {
			copyFromTag: 'nope'
		});

		expect(result.tasksCopied).toBe(0);
		expect(readTasks().empty.tasks).toEqual([]);
	});

	it('creates tasks.json with an empty master when there is none', async () => {
		fs.rmSync(tasksPath);

		await service().createTag('first');

		expect(Object.keys(readTasks())).toEqual(['master', 'first']);
		expect(readTasks().master.tasks).toEqual([]);
	});

	it('refuses an existing name', async () => {
		await expect(service().createTag('feature')).rejects.toThrow(
			'Tag "feature" already exists'
		);
	});

	// tag and _rawTaggedData are fields of the legacy reader (#399); tasks and
	// metadata are the keys of an untagged file (#802)
	it.each([
		'master',
		'Main',
		'default',
		'tag',
		'_rawTaggedData',
		'__proto__',
		'tasks',
		'metadata'
	])(
		'refuses the reserved name %s as a new, renamed or copied tag',
		async (name) => {
			const before = fs.readFileSync(tasksPath, 'utf8');

			await expect(service().createTag(name)).rejects.toThrow(
				`"${name}" is a reserved tag name`
			);
			await expect(service().renameTag('feature', name)).rejects.toThrow(
				`"${name}" is a reserved tag name`
			);
			await expect(service().copyTag('feature', name)).rejects.toThrow(
				`"${name}" is a reserved tag name`
			);
			expect(fs.readFileSync(tasksPath, 'utf8')).toBe(before);
		}
	);

	it('refuses a name with other characters, with a hint', async () => {
		await expect(service().createTag('a b')).rejects.toMatchObject({
			message: `"a b" isn't a valid tag name`,
			hint: expect.stringContaining('letters, numbers')
		});
	});
});

describe('TagService.deleteTag', () => {
	it('deletes the tag and reports its task count', async () => {
		const result = await service().deleteTag('feature');

		expect(result).toEqual({
			tagName: 'feature',
			deleted: true,
			tasksDeleted: 2,
			wasCurrentTag: false,
			switchedToMaster: false
		});
		expect(Object.keys(readTasks())).toEqual(['master']);
	});

	it('makes master current when the current tag is deleted', async () => {
		currentTag = 'feature';

		await service().deleteTag('feature');

		expect(readState().currentTag).toBe('master');
	});

	it('keeps the tag when confirm says no', async () => {
		const confirm = vi.fn().mockResolvedValue(false);

		const result = await service().deleteTag('feature', { confirm });

		expect(confirm).toHaveBeenCalledWith(2);
		expect(result).toEqual({
			tagName: 'feature',
			deleted: false,
			cancelled: true
		});
		expect(Object.keys(readTasks())).toContain('feature');
	});

	it('refuses master and an unknown tag', async () => {
		await expect(service().deleteTag('master')).rejects.toThrow(
			'Cannot delete the "master" tag'
		);
		await expect(service().deleteTag('toString')).rejects.toThrow(
			'Tag "toString" does not exist'
		);
	});
});

describe('TagService.useTag', () => {
	it('records the tag as current in state.json, keeping other keys', async () => {
		fs.writeFileSync(
			statePath,
			JSON.stringify({ currentTag: 'master', branchTagMapping: { a: 'b' } })
		);

		const result = await service().useTag('feature');

		expect(result).toEqual({
			previousTag: 'master',
			currentTag: 'feature',
			switched: true,
			taskCount: 2
		});
		expect(readState()).toMatchObject({
			currentTag: 'feature',
			branchTagMapping: { a: 'b' },
			migrationNoticeShown: false
		});
	});

	it('refuses an unknown tag and leaves state.json alone', async () => {
		await expect(service().useTag('ghost')).rejects.toThrow(
			'Tag "ghost" does not exist'
		);
		expect(readState().currentTag).toBe('master');
	});
});

describe('TagService.renameTag', () => {
	it('renames the tag and notes the old name in its metadata', async () => {
		const result = await service().renameTag('feature', 'feat');

		expect(result).toMatchObject({ renamed: true, taskCount: 2 });
		const file = readTasks();
		expect(Object.keys(file)).toEqual(['master', 'feat']);
		expect(file.feat.metadata.renamed.from).toBe('feature');
		expect(file.feat.metadata.description).toBe('Feat');
	});

	it('keeps a renamed current tag current', async () => {
		currentTag = 'feature';

		const result = await service().renameTag('feature', 'feat');

		expect(result.isCurrentTag).toBe(true);
		expect(readState().currentTag).toBe('feat');
	});

	it('refuses master and an existing name', async () => {
		await expect(service().renameTag('master', 'x')).rejects.toThrow(
			'Cannot rename the "master" tag'
		);
		writeTasks({ ...readTasks(), other: { tasks: [], metadata: {} } });
		await expect(service().renameTag('feature', 'other')).rejects.toThrow(
			'Tag "other" already exists'
		);
	});

	it.each(['tag', 'tasks', 'metadata'])(
		'lists, keeps, renames and deletes a tag named %s already in the file',
		async (name) => {
			writeTasks({
				...readTasks(),
				[name]: { tasks: [task('1')], metadata: {} }
			});

			const listed = await service().listTags();
			expect(listed.tags.map((tag) => tag.name)).toContain(name);
			await service().createTag('other');
			await service().deleteTag('other');
			expect(readTasks()[name].tasks).toHaveLength(1);

			await service().renameTag(name, 'renamed');
			expect(readTasks().renamed.tasks).toHaveLength(1);
			await service().deleteTag('renamed');

			expect(Object.keys(readTasks())).toEqual(['master', 'feature']);
		}
	);
});

// Names that are also Object.prototype members are ordinary names (#379)
describe('FileStorage.renameTag', () => {
	it('refuses a target that exists by the time it writes, keeping its tasks', async () => {
		await expect(
			new FileStorage(projectRoot).renameTag('master', 'feature')
		).rejects.toThrow('Tag "feature" already exists');

		expect(readTasks().feature.tasks).toHaveLength(2);
		expect(readTasks().master.tasks).toHaveLength(1);
	});
});

describe('TagService and a tag named constructor', () => {
	it('creates, uses, copies, renames and deletes it', async () => {
		const tags = service();

		await tags.createTag('constructor');
		await tags.useTag('constructor');
		expect(readState().currentTag).toBe('constructor');
		currentTag = 'constructor';
		await tags.copyTag('constructor', 'hasOwnProperty');
		await tags.renameTag('constructor', 'valueOf');
		currentTag = 'valueOf';
		await tags.deleteTag('valueOf');

		expect(Object.keys(readTasks())).toEqual([
			'master',
			'feature',
			'hasOwnProperty'
		]);
		expect(readState().currentTag).toBe('master');
	});

	it('reports a missing toString tag on use, delete, rename and copy', async () => {
		const tags = service();

		await expect(tags.useTag('toString')).rejects.toThrow('does not exist');
		await expect(tags.deleteTag('toString')).rejects.toThrow('does not exist');
		await expect(tags.renameTag('toString', 'x')).rejects.toThrow(
			'does not exist'
		);
		await expect(tags.copyTag('toString', 'x')).rejects.toThrow(
			'does not exist'
		);
	});
});

describe('TagService.copyTag', () => {
	it('copies the tasks and records where they came from', async () => {
		const result = await service().copyTag('feature', 'feature-2');

		expect(result).toMatchObject({ copied: true, tasksCopied: 2 });
		expect(result.description).toMatch(/^Copy of "feature" created on /);
		const file = readTasks();
		expect(file['feature-2'].tasks).toEqual(file.feature.tasks);
		expect(file['feature-2'].metadata.copiedFrom.tag).toBe('feature');
	});

	it('copies an empty tag', async () => {
		writeTasks({ ...readTasks(), empty: { tasks: [], metadata: {} } });

		const result = await service().copyTag('empty', 'empty-2');

		expect(result.tasksCopied).toBe(0);
		expect(readTasks()['empty-2'].tasks).toEqual([]);
	});

	it('refuses an unknown source and an existing target', async () => {
		await expect(service().copyTag('nope', 'x')).rejects.toThrow(
			'Source tag "nope" does not exist'
		);
		writeTasks({ ...readTasks(), x: { tasks: [], metadata: {} } });
		await expect(service().copyTag('feature', 'x')).rejects.toThrow(
			'Target tag "x" already exists'
		);
	});
});

describe('TagService.listTags', () => {
	it('lists the current tag first, then by name, with defaults filled in', async () => {
		writeTasks({ ...readTasks(), alpha: { tasks: [], metadata: {} } });
		fs.writeFileSync(statePath, JSON.stringify({ currentTag: 'feature' }));

		const result = await service().listTags();

		expect(result.tags.map((t) => t.name)).toEqual([
			'feature',
			'alpha',
			'master'
		]);
		expect(result.currentTag).toBe('feature');
		expect(result.tags[1]).toMatchObject({
			created: 'Unknown',
			description: 'No description',
			subtaskCounts: { totalSubtasks: 0, subtasksByStatus: {} }
		});
		expect(result.tags[0]).toMatchObject({
			taskCount: 2,
			completedTasks: 1,
			readyTasks: 1,
			statusBreakdown: { done: 1, pending: 1 }
		});
	});

	it('with ready, keeps only tags with a task ready to start', async () => {
		writeTasks({ ...readTasks(), alpha: { tasks: [], metadata: {} } });

		const result = await service().listTags({ ready: true });

		expect(result.tags.map((t) => t.name)).toEqual(['master', 'feature']);
		expect(result.totalTags).toBe(2);
	});

	it('fails on an unreadable archive.json instead of listing empty tags', async () => {
		fs.writeFileSync(
			path.join(projectRoot, '.taskgraph', 'tasks', 'archive.json'),
			'{bad'
		);

		await expect(service().listTags()).rejects.toThrow();
	});

	it('counts a task whose dependency was archived as ready', async () => {
		writeTasks({
			master: { tasks: [task('2', 'pending', ['1'])], metadata: {} }
		});
		fs.writeFileSync(
			path.join(projectRoot, '.taskgraph', 'tasks', 'archive.json'),
			JSON.stringify({ master: { tasks: [task('1', 'done')], metadata: {} } })
		);

		const result = await service().listTags();

		expect(result.tags[0].readyTasks).toBe(1);
	});

	it('lists an empty master and writes no file when there is no tasks.json', async () => {
		fs.rmSync(tasksPath);

		const result = await service().listTags();

		expect(result.tags.map((t) => t.name)).toEqual(['master']);
		expect(fs.existsSync(tasksPath)).toBe(false);
	});
});
