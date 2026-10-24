import fs from 'fs';
import path from 'path';
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

function addEmptyTag(name) {
	const data = JSON.parse(fs.readFileSync(TASKS_PATH, 'utf8'));
	data[name] = { tasks: [], metadata: {} };
	fs.writeFileSync(TASKS_PATH, JSON.stringify(data, null, 2));
}

describe('Tag boundary resolution', () => {
	beforeEach(seedWorkspace);
	afterAll(() => fs.rmSync(TEMP_DIR, { recursive: true, force: true }));

	it('addTask to non-master tag does not leak into master', async () => {
		addEmptyTag('feature-api');

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

	it('adds task to tag derived from state.json when no explicit tag supplied', async () => {
		// Create new tag and update state.json to make it current
		addEmptyTag('feature-auto');
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
});
