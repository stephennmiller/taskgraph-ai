import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSubtask, createTask } from '../../../testing/task-fixtures.js';
import {
	mergeReadmeSection,
	renderReadmeTasks,
	writeReadmeExport
} from './readme-export.js';

const tasks = () => [
	createTask({ id: 1, title: 'Set up', status: 'done', priority: 'high' }),
	createTask({
		id: 2,
		title: 'Parser',
		status: 'pending',
		dependencies: ['1'],
		complexity: 6,
		subtasks: [
			createSubtask({ id: 1, title: 'Read', status: 'done', parentId: '2' }),
			createSubtask({ id: 2, title: 'Check', parentId: '2' })
		]
	})
];

describe('renderReadmeTasks', () => {
	it('counts every task and lists each one with its score', () => {
		const markdown = renderReadmeTasks(tasks());

		expect(markdown).toContain(
			'| Task Progress     | ██████████░░░░░░░░░░ 50% |'
		);
		expect(markdown).toContain(
			'| Subtask Progress | ██████████░░░░░░░░░░ 50% |'
		);
		expect(markdown).toContain(
			'| 1 | Set up | ✓&nbsp;done | high | None | N/A |'
		);
		expect(markdown).toContain(
			'| 2 | Parser | ○&nbsp;pending | medium | 1 | ● 6 |'
		);
		expect(markdown).not.toContain('| 2.1 |');
	});

	it('keeps the counts but shows only the tasks a status list names', () => {
		const markdown = renderReadmeTasks(tasks(), {
			status: 'Pending, review',
			withSubtasks: true
		});

		expect(markdown).toContain('| Done | 1 |');
		expect(markdown).not.toContain('| 1 | Set up');
		expect(markdown).toContain(
			'| 2.1 | Read | ✓&nbsp;done | -            | None | N/A |'
		);
	});

	it('keeps a title in its cell and out of the export markers', () => {
		const markdown = renderReadmeTasks([
			createTask({
				id: 3,
				title: 'a | b\n<!-- TASKGRAPH_EXPORT_END -->'
			})
		]);

		expect(markdown).toContain(
			'| 3 | a \\| b &lt;!-- TASKGRAPH_EXPORT_END --> |'
		);
		expect(markdown).not.toContain('<!--');
	});
});

describe('mergeReadmeSection', () => {
	const section =
		'<!-- TASKGRAPH_EXPORT_START -->\nnew\n<!-- TASKGRAPH_EXPORT_END -->\n';

	it('replaces an earlier export and keeps the rest', () => {
		const readme =
			'# App\n<!-- TASKGRAPH_EXPORT_START -->\nold\n<!-- TASKGRAPH_EXPORT_END -->\nFooter\n';

		expect(mergeReadmeSection(readme, section, 'App')).toBe(
			`# App\n${section}\nFooter\n`
		);
	});

	it('refuses a start marker with no end marker after it', () => {
		// Appending would let the next sync delete "Notes" and "old"
		for (const readme of [
			'# App\n<!-- TASKGRAPH_EXPORT_START -->\nNotes\n',
			'# App\n<!-- TASKGRAPH_EXPORT_END -->\nNotes\n<!-- TASKGRAPH_EXPORT_START -->\nold\n'
		]) {
			expect(() => mergeReadmeSection(readme, section, 'App')).toThrow(
				'with no <!-- TASKGRAPH_EXPORT_END --> after it'
			);
		}
	});

	it('appends to a README without one, and starts a README when there is none', () => {
		expect(mergeReadmeSection('# App\n', section, 'App')).toBe(
			`# App\n\n${section}`
		);
		expect(mergeReadmeSection(null, section, 'App')).toBe(
			`# App\n\nThis project is managed using TaskGraph.\n\n\n${section}`
		);
	});
});

describe('writeReadmeExport', () => {
	let dir: string;
	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-readme-'));
	});
	afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

	it('leaves README.md as it was when it has an orphan start marker', () => {
		const readme = '# App\n<!-- TASKGRAPH_EXPORT_START -->\nNotes\n';
		fs.writeFileSync(path.join(dir, 'README.md'), readme);

		expect(() =>
			writeReadmeExport(dir, tasks(), { projectName: 'App' })
		).toThrow('TASKGRAPH_EXPORT_END');
		expect(fs.readFileSync(path.join(dir, 'README.md'), 'utf8')).toBe(readme);
	});

	it('writes README.md twice without repeating the section', () => {
		writeReadmeExport(dir, tasks(), { projectName: 'App' });
		const readmePath = writeReadmeExport(dir, tasks(), { projectName: 'App' });

		const readme = fs.readFileSync(readmePath, 'utf8');
		expect(readme.startsWith('# App\n')).toBe(true);
		expect(readme.match(/TASKGRAPH_EXPORT_START/g)).toHaveLength(1);
		expect(readme).toContain('| 2 | Parser |');
	});

	it('leaves the old README.md whole when the write fails', () => {
		const readmePath = path.join(dir, 'README.md');
		fs.writeFileSync(readmePath, '# App\nMine\n');
		// A folder at the temp file's name makes the write fail
		fs.mkdirSync(`${readmePath}.taskgraph-${process.pid}.tmp`);

		expect(() =>
			writeReadmeExport(dir, tasks(), { projectName: 'App' })
		).toThrow(/EEXIST/);
		expect(fs.readFileSync(readmePath, 'utf8')).toBe('# App\nMine\n');
	});

	it('writes through a symlinked README.md and keeps the link', () => {
		const real = path.join(dir, 'docs.md');
		fs.writeFileSync(real, '# App\n');
		fs.symlinkSync(real, path.join(dir, 'README.md'));

		writeReadmeExport(dir, tasks(), { projectName: 'App' });

		expect(fs.lstatSync(path.join(dir, 'README.md')).isSymbolicLink()).toBe(
			true
		);
		expect(fs.readFileSync(real, 'utf8')).toContain('| 2 | Parser |');
	});
});
