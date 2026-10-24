/**
 * A command run against a tag that does not exist must not create it. readJSON
 * falls back to master's tasks for a missing tag, so a writer that saves under
 * the requested name would create that tag as a copy of master.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { vi } from 'vitest';

vi.doMock('../../../../../scripts/modules/utils.js', async () => {
	const actual = await vi.importActual(
		'../../../../../scripts/modules/utils.js'
	);
	return { ...actual, log: vi.fn(), isSilentMode: vi.fn(() => true) };
});

const { default: clearSubtasks } = await import(
	'../../../../../scripts/modules/task-manager/clear-subtasks.js'
);
const { default: removeSubtask } = await import(
	'../../../../../scripts/modules/task-manager/remove-subtask.js'
);

const master = () => ({
	tasks: [
		{
			id: 1,
			title: 'One',
			description: '',
			status: 'pending',
			dependencies: [],
			subtasks: [
				{
					id: 1,
					title: 'Sub',
					description: '',
					status: 'pending',
					dependencies: []
				}
			]
		}
	],
	metadata: {}
});

describe('writing to a tag that does not exist', () => {
	let dir;
	let tasksPath;
	let before;

	const context = () => ({ projectRoot: dir, tag: 'ghost' });
	const attempt = async (fn) => {
		try {
			await fn();
		} catch {
			// refusing is fine; creating the tag is not
		}
	};

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-ghost-'));
		fs.mkdirSync(path.join(dir, '.taskgraph'), { recursive: true });
		tasksPath = path.join(dir, '.taskgraph', 'tasks.json');
		before = JSON.stringify({ master: master() });
		fs.writeFileSync(tasksPath, before);
		vi.spyOn(console, 'log').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		fs.rmSync(dir, { recursive: true, force: true });
	});

	const tags = () =>
		Object.keys(JSON.parse(fs.readFileSync(tasksPath, 'utf8')));

	test('clear-subtasks', async () => {
		await attempt(() => clearSubtasks(tasksPath, '1', context()));
		expect(tags()).toEqual(['master']);
	});

	test('remove-subtask', async () => {
		await attempt(() =>
			removeSubtask(tasksPath, '1.1', false, false, context())
		);
		expect(tags()).toEqual(['master']);
	});
});
