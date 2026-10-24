/**
 * `tag` and `_rawTaggedData` are keys the legacy code adds to the data it
 * reads. As tag names they used to be dropped from tasks.json on the next
 * write (#399).
 */
// Load ui.js first: Vitest's module runner mishandles the @tm/cli <-> ui.js
// import cycle (`export * as ui`) when @tm/cli is the entry point.
import '../../../../../scripts/modules/ui.js';
import fs from 'fs';
import path from 'path';
import addTask from '../../../../../scripts/modules/task-manager/add-task.js';
import { validateFileOperations } from '../../../../../scripts/modules/task-manager/parse-prd/parse-prd-helpers.js';

const TEMP_DIR = path.join(process.cwd(), '.tmp_internal_key_tag_names');
const TASKS_PATH = path.join(TEMP_DIR, 'tasks.json');
const CONTEXT = { projectRoot: TEMP_DIR };

function tagWithOneTask(title: string) {
	return {
		tasks: [{ id: '1', title, status: 'pending', dependencies: [] }],
		metadata: { created: '2026-01-01T00:00:00.000Z', description: title }
	};
}

function seed(extraTags: Record<string, unknown> = {}) {
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

		it('is refused by parse-prd as its target tag', () => {
			expect(() =>
				validateFileOperations({
					existingTasks: [],
					targetTag: name,
					append: false,
					force: false,
					isMCP: false,
					logger: { report: () => {} }
				})
			).toThrow(`"${name}" is a reserved tag name`);
		});
	});

	describe('already in tasks.json', () => {
		// Writes add metadata.schemaVersion, so these match rather than equal it
		const existing = tagWithOneTask('Kept task');

		beforeEach(() => seed({ [name]: existing }));

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
			expect(data[name]).toMatchObject(existing);
		});
	});
});
