/**
 * `tag` and `_rawTaggedData` are keys the legacy code adds to the data it
 * reads. As tag names they used to be dropped from tasks.json on the next
 * write (#399).
 */
import fs from 'fs';
import path from 'path';
import addTask from '../../../scripts/modules/task-manager/add-task.js';
import {
	copyTag,
	createTag,
	deleteTag,
	renameTag
} from '../../../scripts/modules/task-manager/tag-management.js';

const TEMP_DIR = path.join(process.cwd(), '.tmp_internal_key_tag_names');
const TASKS_PATH = path.join(TEMP_DIR, 'tasks.json');
const CONTEXT = { projectRoot: TEMP_DIR };

function tagWithOneTask(title) {
	return {
		tasks: [{ id: 1, title, status: 'pending', dependencies: [] }],
		metadata: { created: '2026-01-01T00:00:00.000Z', description: title }
	};
}

function seed(extraTags = {}) {
	fs.rmSync(TEMP_DIR, { recursive: true, force: true });
	fs.mkdirSync(path.join(TEMP_DIR, '.taskgraph'), { recursive: true });
	fs.writeFileSync(
		TASKS_PATH,
		JSON.stringify({ master: tagWithOneTask('Seed task'), ...extraTags })
	);
	fs.writeFileSync(
		path.join(TEMP_DIR, '.taskgraph', 'state.json'),
		JSON.stringify({ currentTag: 'master' })
	);
}

function readFile() {
	return JSON.parse(fs.readFileSync(TASKS_PATH, 'utf8'));
}

describe.each(['tag', '_rawTaggedData'])('a tag named %s', (name) => {
	afterAll(() => fs.rmSync(TEMP_DIR, { recursive: true, force: true }));

	describe('as a new name', () => {
		beforeEach(() => seed({ feature: tagWithOneTask('Feature task') }));

		it('is refused by add-tag, and the file is left as it was', async () => {
			const before = readFile();

			await expect(
				createTag(TASKS_PATH, name, {}, CONTEXT, 'json')
			).rejects.toThrow(`"${name}" is a reserved tag name`);

			expect(readFile()).toEqual(before);
		});

		it('is refused by rename-tag', async () => {
			await expect(
				renameTag(TASKS_PATH, 'feature', name, {}, CONTEXT, 'json')
			).rejects.toThrow(`"${name}" is a reserved tag name`);

			expect(readFile().feature).toBeDefined();
		});

		it('is refused by copy-tag', async () => {
			await expect(
				copyTag(TASKS_PATH, 'feature', name, {}, CONTEXT, 'json')
			).rejects.toThrow(`"${name}" is a reserved tag name`);
		});
	});

	describe('already in tasks.json', () => {
		const existing = tagWithOneTask('Kept task');

		beforeEach(() => seed({ [name]: existing }));

		it('survives add-tag writing another tag', async () => {
			await createTag(TASKS_PATH, 'other', {}, CONTEXT, 'json');

			const data = readFile();
			expect(data.other).toBeDefined();
			expect(data[name]).toEqual(existing);
		});

		it('survives delete-tag removing another tag', async () => {
			await createTag(TASKS_PATH, 'other', {}, CONTEXT, 'json');
			await deleteTag(TASKS_PATH, 'other', { yes: true }, CONTEXT, 'json');

			const data = readFile();
			expect(data.other).toBeUndefined();
			expect(data[name]).toEqual(existing);
		});

		it('survives a task being added to master', async () => {
			await addTask(
				TASKS_PATH,
				'New task',
				[],
				null,
				{ ...CONTEXT, tag: 'master' },
				'json',
				{ title: 'New', description: '-', details: '-', testStrategy: '-' },
				false
			);

			const data = readFile();
			expect(data.master.tasks).toHaveLength(2);
			expect(data[name]).toEqual(existing);
		});

		it('can be renamed to a name that is not reserved', async () => {
			await renameTag(TASKS_PATH, name, 'renamed', {}, CONTEXT, 'json');

			const data = readFile();
			expect(data[name]).toBeUndefined();
			expect(data.renamed.tasks).toEqual(existing.tasks);
		});
	});
});
