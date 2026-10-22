import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stripVTControlCharacters as plain } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { displayCommandHeader } from './display-helpers.js';

describe('displayCommandHeader', () => {
	let output: string[];
	let dir: string;

	const writeTags = (...tags: string[]) => {
		const tasksPath = path.join(dir, '.taskgraph', 'tasks', 'tasks.json');
		fs.mkdirSync(path.dirname(tasksPath), { recursive: true });
		fs.writeFileSync(
			tasksPath,
			JSON.stringify(Object.fromEntries(tags.map((t) => [t, { tasks: [] }])))
		);
	};

	beforeEach(() => {
		output = [];
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-header-'));
		vi.spyOn(console, 'log').mockImplementation((line?: unknown) => {
			output.push(String(line));
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it('shows a non-master tag on one line, without a path', () => {
		writeTags('master', 'feature-x');
		displayCommandHeader({ tag: 'feature-x', projectRoot: dir });

		expect(output.map(plain)).toEqual(['[tag] feature-x']);
	});

	it('prints nothing in a project that only has master', () => {
		writeTags('master');
		displayCommandHeader({ tag: 'master', projectRoot: dir });

		expect(output).toEqual([]);
	});

	it('falls back to master, and shows it once there is another tag', () => {
		writeTags('master', 'feature-x');
		displayCommandHeader({ projectRoot: dir });

		expect(output.map(plain)).toEqual(['[tag] master']);
	});
});
