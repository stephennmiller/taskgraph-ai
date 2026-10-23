/**
 * @fileoverview `parse-prd --append` against the built CLI with the fake
 * `claude` program: only sections added since the last parse go to the AI,
 * changed and removed sections are listed, and an unchanged PRD makes no AI
 * call at all (#203).
 *
 * Needs the build (`npm run build`); skipped when dist/ is missing.
 *
 * @integration
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it
} from 'vitest';
import { installFakeClaude } from '../../fakes/install-fake-claude.mjs';
import { getCliBinPath } from '../../helpers/test-utils.js';

const binPath = getCliBinPath();
const built = fs.existsSync(binPath);
if (!built && process.env.CI) {
	throw new Error(
		`${binPath} is missing; run npm run build before these tests in CI`
	);
}

const PRD_V1 = `# Notes app

## Sign-in

Email and password.

## Notes

Create and edit notes.

## Sharing

Share a note by link.
`;

/** Export added, Notes changed, Sharing removed */
const PRD_V2 = `# Notes app

## Sign-in

Email and password.

## Notes

Create, edit and pin notes.

## Export

Export notes as Markdown files.
`;

/** A task as the parse-prd schema wants it back from the model */
const modelTask = (id: number, title: string, section: string) => ({
	id,
	title,
	description: `${title}, described`,
	details: 'Details',
	testStrategy: 'Tests',
	priority: 'medium',
	dependencies: [],
	status: 'pending',
	section
});

describe.skipIf(!built)(
	'parse-prd --append (fake claude)',
	{ timeout: 120000 },
	() => {
		let project: string;
		let work: string;
		let traceFile: string;
		let env: NodeJS.ProcessEnv;

		const taskgraph = (...args: string[]) =>
			spawnSync(process.execPath, [binPath, ...args], {
				cwd: project,
				encoding: 'utf8',
				timeout: 60000,
				env
			});

		const writePrd = (markdown: string) =>
			fs.writeFileSync(path.join(project, 'docs', 'prd.md'), markdown);

		const tagData = () =>
			JSON.parse(
				fs.readFileSync(
					path.join(project, '.taskgraph', 'tasks', 'tasks.json'),
					'utf8'
				)
			).master;

		/** The prompts the fake model was sent, in call order */
		const prompts = (): string[] =>
			fs.existsSync(traceFile)
				? fs
						.readFileSync(traceFile, 'utf8')
						.trim()
						.split('\n')
						.map((line) => JSON.stringify(JSON.parse(line).prompt))
				: [];

		/** Point the project at a fresh fake, answering with `replies` */
		const install = (dir: string, workDir: string, replies: object[]) => {
			const fake = installFakeClaude({ projectDir: dir, workDir, replies });
			traceFile = path.join(fake.dir, 'trace.jsonl');
			env = {
				...process.env,
				FORCE_COLOR: '0',
				COLUMNS: '80',
				TASKGRAPH_SKIP_AUTO_UPDATE: '1',
				...fake.env
			};
		};

		// One project parsed from PRD_V1, copied for each test: init and the first
		// parse take seconds
		let template: string;
		let templateWork: string;

		beforeAll(() => {
			template = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-prd-append-tpl-'));
			templateWork = fs.mkdtempSync(
				path.join(os.tmpdir(), 'tm-prd-append-tw-')
			);
			spawnSync('git', ['init', '-q'], { cwd: template });
			const init = spawnSync(process.execPath, [binPath, 'init', '--yes'], {
				cwd: template,
				encoding: 'utf8',
				env: { ...process.env, TASKGRAPH_SKIP_AUTO_UPDATE: '1' }
			});
			expect(init.status).toBe(0);
			fs.mkdirSync(path.join(template, 'docs'));
			fs.writeFileSync(path.join(template, 'docs', 'prd.md'), PRD_V1);

			install(template, templateWork, [
				{
					object: {
						tasks: [
							modelTask(1, 'Sign-in', 'sign-in'),
							modelTask(2, 'Notes', 'notes'),
							modelTask(3, 'Sharing', 'sharing')
						],
						metadata: null
					}
				}
			]);
			const first = spawnSync(
				process.execPath,
				[binPath, 'parse-prd', 'docs/prd.md', '--force'],
				{ cwd: template, encoding: 'utf8', timeout: 60000, env }
			);
			expect(first.status).toBe(0);
		}, 120000);

		afterAll(() => {
			fs.rmSync(template, { recursive: true, force: true });
			fs.rmSync(templateWork, { recursive: true, force: true });
		});

		beforeEach(() => {
			project = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-prd-append-'));
			work = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-prd-append-work-'));
			fs.cpSync(template, project, { recursive: true });
			install(project, work, [
				{
					object: {
						tasks: [modelTask(4, 'Export notes', 'export')],
						metadata: null
					}
				}
			]);
		});

		afterEach(() => {
			fs.rmSync(project, { recursive: true, force: true });
			fs.rmSync(work, { recursive: true, force: true });
		});

		it('records each task section and the hash of every PRD section', () => {
			const { tasks, metadata } = tagData();

			expect(tasks[1].metadata).toMatchObject({
				source: 'docs/prd.md#notes',
				sourceHash: expect.stringMatching(/^[0-9a-f]{16}$/)
			});
			expect(Object.keys(metadata.prdSections['docs/prd.md'])).toEqual([
				'notes-app',
				'sign-in',
				'notes',
				'sharing'
			]);
		});

		it('makes no AI call and adds no tasks when the PRD is unchanged', () => {
			const res = taskgraph('parse-prd', 'docs/prd.md', '--append');

			expect(res.status).toBe(0);
			expect(res.stdout).toContain(
				'✓ docs/prd.md is unchanged since its tasks were made · no tasks added'
			);
			expect(prompts()).toHaveLength(0);
			expect(tagData().tasks).toHaveLength(3);
		});

		it('sends only new sections, and lists changed and removed ones', () => {
			writePrd(PRD_V2);
			const before = tagData().tasks;

			const res = taskgraph('parse-prd', 'docs/prd.md', '--append');

			expect(res.status).toBe(0);
			expect(res.stdout).toContain('1 new section in docs/prd.md · #export');
			expect(res.stdout).toContain(
				'⚠ 1 changed section · #notes · may be stale: task 2'
			);
			expect(res.stdout).toContain(
				'⚠ 1 removed section · #sharing · task 3 cites it'
			);
			for (const line of res.stdout.split('\n')) {
				expect(line.length).toBeLessThanOrEqual(80);
			}

			const sent = prompts();
			expect(sent).toHaveLength(1);
			expect(sent[0]).toContain('Export notes as Markdown files.');
			expect(sent[0]).not.toContain('Email and password.');
			expect(sent[0]).not.toContain('pin notes');

			const { tasks } = tagData();
			expect(tasks).toHaveLength(4);
			// Changed and removed sections' tasks are left as they were
			expect(tasks.slice(0, 3)).toEqual(before);
			expect(tasks[3].metadata.source).toBe('docs/prd.md#export');
		});

		it('reports a change once, without an AI call when nothing is new', () => {
			writePrd(PRD_V1.replace('Email and password.', 'Email and passkeys.'));

			const changed = taskgraph('parse-prd', 'docs/prd.md', '--append');
			const again = taskgraph('parse-prd', 'docs/prd.md', '--append');

			expect(changed.stdout).toContain(
				'✓ No new sections in docs/prd.md · no tasks added'
			);
			expect(changed.stdout).toContain(
				'⚠ 1 changed section · #sign-in · may be stale: task 1'
			);
			expect(again.stdout).toContain('is unchanged since its tasks were made');
			expect(prompts()).toHaveLength(0);
			expect(tagData().tasks).toHaveLength(3);
		});

		it('forgets the old PRD when a parse without --append replaces its tasks', () => {
			install(project, work, [
				{
					object: { tasks: [modelTask(1, 'Thing', 'thing')], metadata: null }
				}
			]);
			fs.writeFileSync(
				path.join(project, 'docs', 'other.md'),
				'# Other\n\n## Thing\n'
			);

			const res = taskgraph('parse-prd', 'docs/other.md', '--force');

			expect(res.status).toBe(0);
			expect(Object.keys(tagData().metadata.prdSections)).toEqual([
				'docs/other.md'
			]);
		});
	}
);
