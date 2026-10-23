/**
 * @fileoverview The --json contract: every JSON payload the CLI prints carries
 * `schemaVersion`, and each command's shape (keys and value types) is pinned
 * here, run against the built CLI on one fixture project.
 *
 * A failing shape means the output changed:
 *  - a new key: update the pinned shape below (same schemaVersion)
 *  - a removed or renamed key, or a changed type: bump
 *    JSON_OUTPUT_SCHEMA_VERSION in @tm/core, update the shape here and the
 *    contract page (apps/docs/capabilities/json-output.mdx)
 *
 * GitHub push/pull/unlink are pinned in github.command.spec.ts; they need a
 * GitHub repo to run for real.
 *
 * @integration
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JSON_OUTPUT_SCHEMA_VERSION } from '@tm/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { shapeOf } from '../../helpers/json-shape.js';
import { getCliBinPath } from '../../helpers/test-utils.js';

/** The schemaVersion the shapes below describe */
const PINNED_VERSION = 1;

describe('--json contract', () => {
	let dir: string;
	let home: string;

	const run = (args: string[]) =>
		spawnSync('node', [getCliBinPath(), ...args], {
			cwd: dir,
			encoding: 'utf8',
			input: '',
			timeout: 30000,
			env: {
				...process.env,
				HOME: home,
				FORCE_COLOR: '0',
				COLUMNS: '80',
				TASKGRAPH_SKIP_AUTO_UPDATE: '1'
			}
		});

	/** Run a command and parse its JSON output; the payload must be versioned */
	const json = (args: string[], expectedExit = 0) => {
		const result = run(args);
		expect(result.status, result.stderr).toBe(expectedExit);
		const payload = JSON.parse(result.stdout);
		expect(payload.schemaVersion).toBe(JSON_OUTPUT_SCHEMA_VERSION);
		return payload;
	};

	const task = (
		id: number,
		title: string,
		status: string,
		dependencies: number[],
		extra: Record<string, unknown> = {}
	) => ({
		id,
		title,
		description: `${title} description`,
		details: 'Details',
		testStrategy: 'Test it',
		status,
		priority: 'medium',
		dependencies,
		subtasks: [],
		...extra
	});

	beforeAll(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-json-contract-'));
		home = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-json-contract-home-'));
		const init = run(['init', '--yes', '--no-aliases', '--no-git']);
		if (init.status !== 0) {
			throw new Error(
				`taskgraph init failed (build first with \`npm run build\`): ${init.stderr}`
			);
		}
		const tasksFile = path.join(dir, '.taskgraph', 'tasks', 'tasks.json');
		const data = JSON.parse(fs.readFileSync(tasksFile, 'utf8'));
		data.master.tasks = [
			task(1, 'Set up the API', 'done', []),
			task(2, 'Add Postgres', 'pending', [1], {
				acceptanceCriteria: [{ text: 'Migrations run', checked: false }],
				subtasks: [
					{
						id: 1,
						title: 'Schema',
						description: 'Write the schema',
						details: '',
						status: 'pending',
						dependencies: []
					},
					{
						id: 2,
						title: 'Migrations',
						description: 'Add migrations',
						details: '',
						status: 'pending',
						dependencies: [1]
					}
				]
			}),
			task(3, 'Sign-in', 'pending', [2])
		];
		// next --claim writes, so it gets its own tag. Its metadata has no
		// created or description, as in older files: tags lists them as optional
		data.claim = {
			tasks: [task(1, 'Claim me', 'pending', [])],
			metadata: {}
		};
		data.empty = {
			tasks: [],
			metadata: { created: '2026-01-01T00:00:00.000Z', description: 'Empty' }
		};
		fs.writeFileSync(tasksFile, JSON.stringify(data, null, 2));
	}, 60000);

	afterAll(() => {
		fs.rmSync(dir, { recursive: true, force: true });
		fs.rmSync(home, { recursive: true, force: true });
	});

	it('describes the current schemaVersion', () => {
		// Bumping the version means revisiting every shape below
		expect(PINNED_VERSION).toBe(JSON_OUTPUT_SCHEMA_VERSION);
	});

	it('list', () => {
		expect(shapeOf(json(['list', '--json']))).toMatchInlineSnapshot(`
			{
			  "metadata": {
			    "allTags": "boolean",
			    "filtered": "number",
			    "tag": "string",
			    "total": "number",
			  },
			  "schemaVersion": "number",
			  "tasks": [
			    {
			      "blocks": [
			        "string",
			      ],
			      "dependencies": [
			        "string",
			      ],
			      "description": "string",
			      "details": "string",
			      "id": "string",
			      "priority": "string",
			      "status": "string",
			      "subtasks": [],
			      "testStrategy": "string",
			      "title": "string",
			    },
			  ],
			}
		`);
	});

	it('show: one task', () => {
		expect(shapeOf(json(['show', '2', '--json']))).toMatchInlineSnapshot(`
			{
			  "found": "boolean",
			  "schemaVersion": "number",
			  "task": {
			    "acceptanceCriteria": [
			      {
			        "checked": "boolean",
			        "text": "string",
			      },
			    ],
			    "dependencies": [
			      "number",
			    ],
			    "description": "string",
			    "details": "string",
			    "id": "number",
			    "priority": "string",
			    "status": "string",
			    "subtasks": [
			      {
			        "dependencies": [
			          "number",
			        ],
			        "description": "string",
			        "details": "string",
			        "id": "number",
			        "status": "string",
			        "title": "string",
			      },
			    ],
			    "testStrategy": "string",
			    "title": "string",
			  },
			}
		`);
	});

	it('show: a subtask', () => {
		expect(shapeOf(json(['show', '2.1', '--json']))).toMatchInlineSnapshot(`
			{
			  "found": "boolean",
			  "originalTaskId": "string",
			  "schemaVersion": "number",
			  "task": {
			    "dependencies": [],
			    "description": "string",
			    "details": "string",
			    "id": "number",
			    "status": "string",
			    "title": "string",
			  },
			}
		`);
	});

	it('show: several tasks', () => {
		expect(
			shapeOf(json(['show', '2,3', '--format', 'json']))
		).toMatchInlineSnapshot(`
			{
			  "notFound": [],
			  "schemaVersion": "number",
			  "tasks": [
			    {
			      "acceptanceCriteria?": [
			        {
			          "checked": "boolean",
			          "text": "string",
			        },
			      ],
			      "dependencies": [
			        "number",
			      ],
			      "description": "string",
			      "details": "string",
			      "id": "number",
			      "priority": "string",
			      "status": "string",
			      "subtasks": [
			        {
			          "dependencies": [
			            "number",
			          ],
			          "description": "string",
			          "details": "string",
			          "id": "number",
			          "status": "string",
			          "title": "string",
			        },
			      ],
			      "testStrategy": "string",
			      "title": "string",
			    },
			  ],
			}
		`);
	});

	it('show: a task that does not exist', () => {
		expect(shapeOf(json(['show', '99', '--json'], 1))).toMatchInlineSnapshot(`
			{
			  "found": "boolean",
			  "schemaVersion": "number",
			  "task": "null",
			}
		`);
	});

	it('next', () => {
		expect(shapeOf(json(['next', '--format', 'json']))).toMatchInlineSnapshot(`
			{
			  "checklist": {
			    "checkedCount": "number",
			    "items": [
			      {
			        "checked": "boolean",
			        "number": "number",
			        "source": "string",
			        "text": "string",
			      },
			    ],
			    "unchecked": [
			      {
			        "checked": "boolean",
			        "number": "number",
			        "source": "string",
			        "text": "string",
			      },
			    ],
			  },
			  "found": "boolean",
			  "hasAnyTasks": "boolean",
			  "schemaVersion": "number",
			  "tag": "string",
			  "task": {
			    "dependencies": [
			      "string",
			    ],
			    "description": "string",
			    "details": "string",
			    "id": "string",
			    "priority": "string",
			    "status": "string",
			    "subtasks": [
			      {
			        "dependencies": [
			          "number",
			        ],
			        "description": "string",
			        "details": "string",
			        "id": "string",
			        "parentId": "string",
			        "status": "string",
			        "title": "string",
			      },
			    ],
			    "testStrategy": "string",
			    "title": "string",
			  },
			}
		`);
	});

	it('next: nothing to do', () => {
		expect(
			shapeOf(json(['next', '--tag', 'empty', '--format', 'json']))
		).toMatchInlineSnapshot(`
			{
			  "found": "boolean",
			  "hasAnyTasks": "boolean",
			  "schemaVersion": "number",
			  "tag": "string",
			  "task": "null",
			}
		`);
	});

	it('next --claim', () => {
		expect(
			shapeOf(json(['next', '--claim', '--tag', 'claim', '--format', 'json']))
		).toMatchInlineSnapshot(`
			{
			  "claimed": "boolean",
			  "claimedAt": "string",
			  "claimedBy": "string",
			  "hasAnyTasks": "boolean",
			  "schemaVersion": "number",
			  "tag": "string",
			  "task": {
			    "dependencies": [],
			    "description": "string",
			    "details": "string",
			    "id": "string",
			    "metadata": {
			      "claimedAt": "string",
			      "claimedBy": "string",
			    },
			    "priority": "string",
			    "status": "string",
			    "subtasks": [],
			    "testStrategy": "string",
			    "title": "string",
			    "updatedAt": "string",
			  },
			}
		`);
	});

	it('graph', () => {
		expect(shapeOf(json(['graph', '--format', 'json']))).toMatchInlineSnapshot(`
			{
			  "bottlenecks": [
			    {
			      "blocks": "number",
			      "id": "string",
			      "status": "string",
			      "title": "string",
			    },
			  ],
			  "criticalPath": [
			    "string",
			  ],
			  "cyclic": [],
			  "nextId": "string",
			  "roots": [
			    {
			      "alsoNeeds": [],
			      "children": [
			        {
			          "alsoNeeds": [],
			          "children": [
			            {
			              "alsoNeeds": [],
			              "children": [],
			              "id": "string",
			              "inferred": [],
			              "missing": [],
			              "priority": "string",
			              "status": "string",
			              "title": "string",
			              "wave": "number",
			            },
			          ],
			          "id": "string",
			          "inferred": [],
			          "missing": [],
			          "priority": "string",
			          "status": "string",
			          "title": "string",
			          "wave": "number",
			        },
			      ],
			      "id": "string",
			      "inferred": [],
			      "missing": [],
			      "priority": "string",
			      "status": "string",
			      "title": "string",
			      "wave": "null",
			    },
			  ],
			  "schemaVersion": "number",
			  "tag": "string",
			  "total": "number",
			  "waves": {
			    "unscheduled": [],
			    "waveOf": {
			      "2": "number",
			      "3": "number",
			    },
			    "waves": [
			      [
			        "string",
			      ],
			    ],
			  },
			}
		`);
	});

	it('why', () => {
		expect(
			shapeOf(json(['why', '3', '--format', 'json']))
		).toMatchInlineSnapshot(`
			{
			  "blocked": "boolean",
			  "blockers": [
			    {
			      "blockers": [],
			      "id": "string",
			      "kind": "string",
			      "status": "string",
			      "title": "string",
			    },
			  ],
			  "id": "string",
			  "rootCauses": [
			    {
			      "id": "string",
			      "kind": "string",
			      "status": "string",
			      "title": "string",
			    },
			  ],
			  "schemaVersion": "number",
			  "status": "string",
			  "tag": "string",
			  "title": "string",
			}
		`);
	});

	it('tags', () => {
		// Status counts are keyed by status name: data, not shape
		const records = ['statusBreakdown', 'subtasksByStatus'];
		expect(
			shapeOf(json(['tags', '--json']), { records })
		).toMatchInlineSnapshot(`
			{
			  "currentTag": "string",
			  "schemaVersion": "number",
			  "tags": [
			    {
			      "completedTasks": "number",
			      "created?": "string",
			      "description?": "string",
			      "isCurrent": "boolean",
			      "name": "string",
			      "readyTasks": "number",
			      "statusBreakdown": {
			        "<key>": "number",
			      },
			      "subtaskCounts?": {
			        "subtasksByStatus": {
			          "<key>": "number",
			        },
			        "totalSubtasks": "number",
			      },
			      "taskCount": "number",
			    },
			  ],
			  "totalTags": "number",
			}
		`);
	});

	it('prime', () => {
		expect(shapeOf(json(['prime', '--json']))).toMatchInlineSnapshot(`
			{
			  "counts": {
			    "done": "number",
			    "total": "number",
			  },
			  "inProgress": [],
			  "ready": [
			    {
			      "id": "string",
			      "priority": "string",
			      "status": "string",
			      "title": "string",
			    },
			  ],
			  "rules": [
			    {
			      "command": "string",
			      "text": "string",
			    },
			  ],
			  "schemaVersion": "number",
			  "tag": "string",
			}
		`);
	});

	it('prime --unnoted-since', () => {
		expect(
			shapeOf(
				json(['prime', '--unnoted-since', '2026-01-01T00:00:00Z', '--json'])
			)
		).toMatchInlineSnapshot(`
			{
			  "schemaVersion": "number",
			  "unnoted": [],
			}
		`);
	});

	it('generate', () => {
		expect(
			shapeOf(json(['generate', '--format', 'json']))
		).toMatchInlineSnapshot(`
			{
			  "count": "number",
			  "directory": "string",
			  "orphanedFilesRemoved": "number",
			  "schemaVersion": "number",
			  "success": "boolean",
			}
		`);
	});

	it('set-status', () => {
		expect(
			shapeOf(json(['set-status', '3', 'pending', '--format', 'json']))
		).toMatchInlineSnapshot(`
			{
			  "schemaVersion": "number",
			  "success": "boolean",
			  "updatedTasks": [
			    {
			      "newStatus": "string",
			      "oldStatus": "string",
			      "taskId": "string",
			    },
			  ],
			}
		`);
	});

	it('set-status: a failure', () => {
		expect(
			shapeOf(json(['set-status', '99', 'done', '--format', 'json'], 1))
		).toMatchInlineSnapshot(`
			{
			  "error": "string",
			  "schemaVersion": "number",
			  "success": "boolean",
			  "taskId": "string",
			  "timestamp": "string",
			}
		`);
	});

	it('start --dry-run', () => {
		expect(
			shapeOf(json(['start', '2', '--dry-run', '--format', 'json']))
		).toMatchInlineSnapshot(`
			{
			  "command": {
			    "args": [
			      "string",
			    ],
			    "cwd": "string",
			    "executable": "string",
			  },
			  "executionOutput": "string",
			  "found": "boolean",
			  "schemaVersion": "number",
			  "started": "boolean",
			  "task": {
			    "acceptanceCriteria": [
			      {
			        "checked": "boolean",
			        "text": "string",
			      },
			    ],
			    "dependencies": [
			      "number",
			    ],
			    "description": "string",
			    "details": "string",
			    "id": "number",
			    "priority": "string",
			    "status": "string",
			    "subtasks": [
			      {
			        "dependencies": [
			          "number",
			        ],
			        "description": "string",
			        "details": "string",
			        "id": "number",
			        "status": "string",
			        "title": "string",
			      },
			    ],
			    "testStrategy": "string",
			    "title": "string",
			  },
			}
		`);
	});

	it('github status', () => {
		expect(
			shapeOf(json(['github', 'status', '--repo', 'acme/app', '--json']))
		).toMatchInlineSnapshot(`
			{
			  "ghAvailable": "boolean",
			  "linkedTasks": "number",
			  "repo": "string",
			  "schemaVersion": "number",
			  "unlinkedTasks": "number",
			}
		`);
	});

	it('autopilot status', () => {
		expect(
			shapeOf(json(['autopilot', 'status', '--json']))
		).toMatchInlineSnapshot(`
			{
			  "active": "boolean",
			  "message": "string",
			  "schemaVersion": "number",
			}
		`);
	});
});
