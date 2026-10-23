import fs from 'fs';
import path from 'path';
import {
	copyTag,
	createTag,
	deleteTag,
	renameTag,
	useTag
} from '../../../scripts/modules/task-manager/tag-management.js';
import { moveTasksBetweenTags } from '../../../scripts/modules/task-manager/move-task.js';
import { validateFileOperations } from '../../../scripts/modules/task-manager/parse-prd/parse-prd-helpers.js';

// Temporary workspace for each test run
const TEMP_DIR = path.join(process.cwd(), '.tmp_tag_boundary');
const TASKS_PATH = path.join(TEMP_DIR, 'tasks.json');
const STATE_PATH = path.join(TEMP_DIR, '.taskgraph', 'state.json');

function seedWorkspace() {
	// Reset temp dir
	fs.rmSync(TEMP_DIR, { recursive: true, force: true });
	fs.mkdirSync(path.join(TEMP_DIR, '.taskgraph'), {
		recursive: true,
		force: true
	});

	// Minimal master tag file
	fs.writeFileSync(
		TASKS_PATH,
		JSON.stringify(
			{
				master: {
					tasks: [{ id: 1, title: 'Seed task', status: 'pending' }],
					metadata: { created: new Date().toISOString() }
				}
			},
			null,
			2
		),
		'utf8'
	);

	// Initial state.json
	fs.writeFileSync(
		STATE_PATH,
		JSON.stringify(
			{ currentTag: 'master', lastSwitched: new Date().toISOString() },
			null,
			2
		),
		'utf8'
	);
}

describe('Tag boundary resolution', () => {
	beforeEach(seedWorkspace);
	afterAll(() => fs.rmSync(TEMP_DIR, { recursive: true, force: true }));

	it('switches currentTag in state.json when useTag succeeds', async () => {
		await createTag(
			TASKS_PATH,
			'feature-x',
			{},
			{ projectRoot: TEMP_DIR },
			'json'
		);
		await useTag(
			TASKS_PATH,
			'feature-x',
			{},
			{ projectRoot: TEMP_DIR },
			'json'
		);

		const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
		expect(state.currentTag).toBe('feature-x');
	});

	it('throws error when switching to non-existent tag', async () => {
		await expect(
			useTag(TASKS_PATH, 'ghost', {}, { projectRoot: TEMP_DIR }, 'json')
		).rejects.toThrow(/does not exist/);
	});

	it('deleting active tag auto-switches back to master', async () => {
		await createTag(TASKS_PATH, 'temp', {}, { projectRoot: TEMP_DIR }, 'json');
		await useTag(TASKS_PATH, 'temp', {}, { projectRoot: TEMP_DIR }, 'json');

		// Delete the active tag with force flag (yes: true)
		await deleteTag(
			TASKS_PATH,
			'temp',
			{ yes: true },
			{ projectRoot: TEMP_DIR },
			'json'
		);

		const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
		expect(state.currentTag).toBe('master');

		const tasksFile = JSON.parse(fs.readFileSync(TASKS_PATH, 'utf8'));
		expect(tasksFile.temp).toBeUndefined();
		expect(tasksFile.master).toBeDefined();
	});

	it('createTag with copyFromCurrent deep-copies tasks (mutation isolated)', async () => {
		// create new tag with copy
		await createTag(
			TASKS_PATH,
			'alpha',
			{ copyFromCurrent: true },
			{ projectRoot: TEMP_DIR },
			'json'
		);

		// mutate a field inside alpha tasks
		const updatedData = JSON.parse(fs.readFileSync(TASKS_PATH, 'utf8'));
		updatedData.alpha.tasks[0].title = 'Changed in alpha';
		fs.writeFileSync(TASKS_PATH, JSON.stringify(updatedData, null, 2));

		const finalData = JSON.parse(fs.readFileSync(TASKS_PATH, 'utf8'));
		expect(finalData.master.tasks[0].title).toBe('Seed task');
		expect(finalData.alpha.tasks[0].title).toBe('Changed in alpha');
	});

	it('addTask to non-master tag does not leak into master', async () => {
		// create and switch
		await createTag(
			TASKS_PATH,
			'feature-api',
			{},
			{ projectRoot: TEMP_DIR },
			'json'
		);

		// Call addTask with manual data to avoid AI
		const { default: addTask } = await import(
			'../../../scripts/modules/task-manager/add-task.js'
		);

		await addTask(
			TASKS_PATH,
			'Manual task',
			[],
			null,
			{ projectRoot: TEMP_DIR, tag: 'feature-api' },
			'json',
			{
				title: 'API work',
				description: 'Implement endpoint',
				details: 'Details',
				testStrategy: 'Tests'
			},
			false
		);

		const data = JSON.parse(fs.readFileSync(TASKS_PATH, 'utf8'));
		expect(data['feature-api'].tasks.length).toBe(1); // the new task only
		expect(data.master.tasks.length).toBe(1); // still only seed
	});

	it('reserved tag names are rejected', async () => {
		await expect(
			createTag(TASKS_PATH, 'master', {}, { projectRoot: TEMP_DIR }, 'json')
		).rejects.toThrow(/reserved tag/i);
	});

	it('cannot delete the master tag', async () => {
		await expect(
			deleteTag(
				TASKS_PATH,
				'master',
				{ yes: true },
				{ projectRoot: TEMP_DIR },
				'json'
			)
		).rejects.toThrow(/Cannot delete the "master" tag/);
	});

	it('copyTag deep copy – mutation does not affect source', async () => {
		const { copyTag } = await import(
			'../../../scripts/modules/task-manager/tag-management.js'
		);

		await createTag(
			TASKS_PATH,
			'source',
			{ copyFromCurrent: true },
			{ projectRoot: TEMP_DIR },
			'json'
		);
		await copyTag(
			TASKS_PATH,
			'source',
			'clone',
			{},
			{ projectRoot: TEMP_DIR },
			'json'
		);

		// mutate clone task title
		const data1 = JSON.parse(fs.readFileSync(TASKS_PATH, 'utf8'));
		data1.clone.tasks[0].title = 'Modified in clone';
		fs.writeFileSync(TASKS_PATH, JSON.stringify(data1, null, 2));

		const data2 = JSON.parse(fs.readFileSync(TASKS_PATH, 'utf8'));
		expect(data2.source.tasks[0].title).toBe('Seed task');
		expect(data2.clone.tasks[0].title).toBe('Modified in clone');
	});

	it('adds task to tag derived from state.json when no explicit tag supplied', async () => {
		// Create new tag and update state.json to make it current
		await createTag(
			TASKS_PATH,
			'feature-auto',
			{},
			{ projectRoot: TEMP_DIR },
			'json'
		);
		const state1 = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
		state1.currentTag = 'feature-auto';
		fs.writeFileSync(STATE_PATH, JSON.stringify(state1, null, 2));

		const { default: addTask } = await import(
			'../../../scripts/modules/task-manager/add-task.js'
		);
		const { resolveTag } = await import('../../../scripts/modules/utils.js');

		const tag = resolveTag({ projectRoot: TEMP_DIR });

		// Add task without passing tag -> should resolve to feature-auto
		await addTask(
			TASKS_PATH,
			'Auto task',
			[],
			null,
			{ projectRoot: TEMP_DIR, tag },
			'json',
			{
				title: 'Auto task',
				description: '-',
				details: '-',
				testStrategy: '-'
			},
			false
		);

		const data = JSON.parse(fs.readFileSync(TASKS_PATH, 'utf8'));
		expect(data['feature-auto'].tasks.length).toBe(1);
		expect(data.master.tasks.length).toBe(1); // master unchanged
	});

	it('falls back to master when state.json lacks currentTag', async () => {
		// wipe currentTag field
		fs.writeFileSync(STATE_PATH, JSON.stringify({}, null, 2));

		const { default: addTask } = await import(
			'../../../scripts/modules/task-manager/add-task.js'
		);
		const { resolveTag } = await import('../../../scripts/modules/utils.js');

		const tag = resolveTag({ projectRoot: TEMP_DIR }); // should return master

		await addTask(
			TASKS_PATH,
			'Fallback task',
			[],
			null,
			{ projectRoot: TEMP_DIR, tag },
			'json',
			{
				title: 'Fallback',
				description: '-',
				details: '-',
				testStrategy: '-'
			},
			false
		);

		const data = JSON.parse(fs.readFileSync(TASKS_PATH, 'utf8'));
		expect(data.master.tasks.length).toBe(2); // seed + new task
	});
});

// Tag names that are also Object.prototype members are ordinary names (#379)
describe('Tag names shared with Object.prototype', () => {
	beforeEach(seedWorkspace);
	afterAll(() => fs.rmSync(TEMP_DIR, { recursive: true, force: true }));

	const ctx = { projectRoot: TEMP_DIR };
	const readTasks = () => JSON.parse(fs.readFileSync(TASKS_PATH, 'utf8'));
	const readState = () => JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));

	it('creates, uses, renames and deletes a tag named constructor', async () => {
		await createTag(TASKS_PATH, 'constructor', {}, ctx, 'json');
		expect(Object.keys(readTasks())).toEqual(['master', 'constructor']);

		await useTag(TASKS_PATH, 'constructor', {}, ctx, 'json');
		expect(readState().currentTag).toBe('constructor');

		await copyTag(TASKS_PATH, 'constructor', 'hasOwnProperty', {}, ctx, 'json');
		await renameTag(TASKS_PATH, 'constructor', 'valueOf', {}, ctx, 'json');
		await deleteTag(TASKS_PATH, 'valueOf', { yes: true }, ctx, 'json');

		expect(Object.keys(readTasks())).toEqual(['master', 'hasOwnProperty']);
		expect(readState().currentTag).toBe('master');
	});

	it('refuses to switch to a missing tag named toString', async () => {
		await expect(
			useTag(TASKS_PATH, 'toString', {}, ctx, 'json')
		).rejects.toThrow('Tag "toString" does not exist');
		expect(readState().currentTag).toBe('master');
	});

	it('reports missing tags named toString on delete, rename and copy', async () => {
		await expect(
			deleteTag(TASKS_PATH, 'toString', { yes: true }, ctx, 'json')
		).rejects.toThrow('Tag "toString" does not exist');
		await expect(
			renameTag(TASKS_PATH, 'toString', 'other', {}, ctx, 'json')
		).rejects.toThrow('Tag "toString" does not exist');
		await expect(
			copyTag(TASKS_PATH, 'toString', 'other', {}, ctx, 'json')
		).rejects.toThrow('Source tag "toString" does not exist');
	});

	it('rejects __proto__ as a tag name and leaves the file alone', async () => {
		const before = fs.readFileSync(TASKS_PATH, 'utf8');

		await expect(
			createTag(TASKS_PATH, '__proto__', {}, ctx, 'json')
		).rejects.toThrow('"__proto__" is a reserved tag name');
		await expect(
			copyTag(TASKS_PATH, 'master', '__proto__', {}, ctx, 'json')
		).rejects.toThrow('"__proto__" is a reserved tag name');
		await expect(
			useTag(TASKS_PATH, '__proto__', {}, ctx, 'json')
		).rejects.toThrow('Tag "__proto__" does not exist');

		expect(fs.readFileSync(TASKS_PATH, 'utf8')).toBe(before);
		expect({}.tasks).toBeUndefined();
	});

	it('refuses to create a __proto__ tag by moving or parsing a PRD into it', async () => {
		const before = fs.readFileSync(TASKS_PATH, 'utf8');

		await expect(
			moveTasksBetweenTags(TASKS_PATH, ['1'], 'master', '__proto__', {}, ctx)
		).rejects.toThrow('"__proto__" is a reserved tag name');
		expect(() =>
			validateFileOperations({
				existingTasks: [],
				targetTag: '__proto__',
				append: false,
				force: false,
				isMCP: false,
				logger: { report: () => {} }
			})
		).toThrow('"__proto__" is a reserved tag name');

		expect(fs.readFileSync(TASKS_PATH, 'utf8')).toBe(before);
	});

	it('deletes a __proto__ tag that is already in the file', async () => {
		// JSON.parse keeps a "__proto__" key as data, as a hand edit would leave it
		fs.writeFileSync(
			TASKS_PATH,
			'{"master":{"tasks":[],"metadata":{}},"__proto__":{"tasks":[],"metadata":{}}}'
		);

		await deleteTag(TASKS_PATH, '__proto__', { yes: true }, ctx, 'json');

		expect(Object.keys(readTasks())).toEqual(['master']);
	});
});
