import fs from 'fs';
import path from 'path';
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

// Tag names that are also Object.prototype members are ordinary names (#379)
describe('Tag names shared with Object.prototype', () => {
	beforeEach(seedWorkspace);
	afterAll(() => fs.rmSync(TEMP_DIR, { recursive: true, force: true }));

	const ctx = { projectRoot: TEMP_DIR };

	it('refuses to create a __proto__ tag by parsing a PRD into it', () => {
		const before = fs.readFileSync(TASKS_PATH, 'utf8');

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
