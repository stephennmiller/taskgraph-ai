/**
 * @fileoverview parse_prd's clarify and clarifications options, on the built
 * MCP server with the fake `claude` program in place of a real model.
 *
 * @integration
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	installFakeClaude,
	readTrace
} from '../../../../cli/tests/fakes/install-fake-claude.mjs';
import { callMCPTool } from '../../helpers/call-mcp-tool.js';

const PRD = '# Bookmarks\n\nA web app to save links and tag them.\n';
const QUESTION = {
	question: 'Which database should the app use?',
	suggestedAnswer: 'PostgreSQL 16'
};
const TASKS = {
	object: {
		tasks: [
			{
				id: 1,
				title: 'Set up the SQLite schema',
				description: 'Tables for users and bookmarks.',
				details: 'Use migrations.',
				testStrategy: 'Run the migrations on an empty database.',
				priority: 'high',
				dependencies: [],
				status: 'pending'
			}
		],
		metadata: null
	}
};

describe('parse_prd MCP tool: clarify', () => {
	let project: string;
	let work: string;
	let fakeDir: string;
	const savedEnv = { ...process.env };

	beforeEach(() => {
		project = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-mcp-clarify-'));
		work = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-mcp-clarify-work-'));
		process.chdir(project);
		const cliPath = path.resolve(__dirname, '../../../../../dist/taskgraph.js');
		execSync(`node "${cliPath}" init --yes`, {
			stdio: 'pipe',
			env: { ...process.env, TASKGRAPH_SKIP_AUTO_UPDATE: '1' }
		});
		fs.writeFileSync(path.join(project, 'prd.md'), PRD);
	});

	// Replies are served in call order, so each test installs the ones its
	// own calls need: clarify makes one call, clarifications only the tasks call
	const install = (replies: object[]) => {
		const fake = installFakeClaude({
			projectDir: project,
			workDir: work,
			replies
		});
		fakeDir = fake.dir;
		Object.assign(process.env, fake.env);
	};

	afterEach(() => {
		process.chdir(path.resolve(__dirname, '../../../../..'));
		process.env = { ...savedEnv };
		fs.rmSync(project, { recursive: true, force: true });
		fs.rmSync(work, { recursive: true, force: true });
	});

	it('clarify returns the questions and generates nothing', () => {
		install([{ object: { questions: [QUESTION] } }]);

		const reply = callMCPTool('parse_prd', {
			projectRoot: project,
			input: path.join(project, 'prd.md'),
			clarify: true
		});

		expect(reply.data.questions).toEqual([QUESTION]);
		expect(fs.readFileSync(path.join(project, 'prd.md'), 'utf8')).toBe(PRD);
		expect(readTrace(fakeDir)).toHaveLength(1);
	});

	it('clarifications are saved in the PRD before the tasks are generated', () => {
		install([TASKS]);

		const reply = callMCPTool('parse_prd', {
			projectRoot: project,
			input: path.join(project, 'prd.md'),
			force: true,
			clarifications: [{ question: QUESTION.question, answer: 'SQLite' }]
		});

		expect(reply.data.clarifications).toEqual({
			added: 1,
			updated: 0,
			unchanged: 0
		});
		expect(fs.readFileSync(path.join(project, 'prd.md'), 'utf8')).toContain(
			'## Clarifications\n\n- **Q:** Which database should the app use?\n  **A:** SQLite\n'
		);
		// The task generation call read the PRD with the answer in it
		const trace = readTrace(fakeDir);
		expect(trace).toHaveLength(1);
		expect(trace[0].prompt).toContain('**A:** SQLite');
	});
});
