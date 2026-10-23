/**
 * @fileoverview Integration tests for `taskgraph models` and `taskgraph lang`,
 * run against the built CLI in a fresh project.
 *
 * @integration
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getCliBinPath } from '../../helpers/test-utils.js';

describe('models and lang commands', () => {
	let dir: string;
	let home: string;

	const run = (args: string[]) =>
		spawnSync('node', [getCliBinPath(), ...args], {
			cwd: dir,
			encoding: 'utf8',
			env: {
				...process.env,
				HOME: home,
				FORCE_COLOR: '0',
				TASKGRAPH_SKIP_AUTO_UPDATE: '1'
			}
		});

	const configPath = () => path.join(dir, '.taskgraph', 'config.json');
	const readConfig = () => JSON.parse(fs.readFileSync(configPath(), 'utf8'));

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-models-'));
		home = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-models-home-'));
		run(['init', '--yes', '--no-aliases', '--no-git']);
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
		fs.rmSync(home, { recursive: true, force: true });
	});

	it('lists each role and its model within 80 columns', () => {
		const result = run(['models']);

		expect(result.status).toBe(0);
		expect(result.stdout).toMatch(/Main\s+sonnet\s+creates and updates tasks/);
		expect(result.stdout).toContain('opus (most capable)');
		expect(result.stdout).toContain('taskgraph models --setup');
		// No provider column, SWE scores or $0 costs
		expect(result.stdout).not.toContain('claude-code');
		expect(result.stdout).not.toContain('SWE');
		for (const line of result.stdout.split('\n')) {
			expect(line.length).toBeLessThanOrEqual(80);
		}
	});

	it('confirms a model change with before and after', () => {
		const result = run(['models', '--set-main', 'opus']);

		expect(result.status).toBe(0);
		expect(result.stdout).toContain('Main model  sonnet → opus');
		expect(readConfig().models.main.modelId).toBe('opus');
	});

	it('says when a model was already set', () => {
		const result = run(['models', '--set-main', 'sonnet']);

		expect(result.stdout).toContain('Main model  sonnet (unchanged)');
	});

	it('rejects an unknown model, exits 1 and sets nothing', () => {
		const result = run([
			'models',
			'--set-main',
			'opus',
			'--set-research',
			'gpt-4o'
		]);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain(`"gpt-4o" isn't a Claude Code model`);
		// The valid flag isn't applied when another one is wrong
		expect(readConfig().models.main.modelId).toBe('sonnet');
	});

	it('reports a missing config once, as an error', () => {
		fs.mkdirSync(path.join(dir, '.taskgraph', 'tasks'), { recursive: true });
		fs.writeFileSync(
			path.join(dir, '.taskgraph', 'tasks', 'tasks.json'),
			'{"master":{"tasks":[]}}'
		);
		fs.rmSync(configPath());

		const result = run(['models']);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain(
			'No .taskgraph/config.json in this project'
		);
		expect(result.stderr).not.toContain('using default settings');
	});

	it('warns about each unsupported provider once, with the project path (#269)', () => {
		const config = readConfig();
		config.models.main = { provider: 'anthropic', modelId: 'claude-3-7' };
		config.models.research = { provider: 'perplexity', modelId: 'sonar-pro' };
		fs.writeFileSync(configPath(), JSON.stringify(config));

		const result = run(['models']);

		expect(result.status).toBe(0);
		expect(result.stderr).toBe(
			'⚠ Main provider "anthropic" isn\'t supported; using sonnet\n' +
				'⚠ Research provider "perplexity" isn\'t supported; using sonnet\n' +
				'  Run taskgraph models --setup to update .taskgraph/config.json\n'
		);
		expect(result.stdout).toMatch(/Main\s+sonnet/);
	});

	it('sets the response language without an error', () => {
		// setResponseLanguage used to save the language, then fail on an
		// undefined variable and exit 1
		const result = run(['lang', '--response', 'French']);

		expect(result.status).toBe(0);
		expect(result.stdout).toContain('Response language  English → French');
		expect(readConfig().global.responseLanguage).toBe('French');
	});

	it('shows the response language instead of resetting it', () => {
		run(['lang', '--response', 'French']);

		const result = run(['lang']);

		expect(result.status).toBe(0);
		expect(result.stdout).toContain('Response language: French');
		expect(readConfig().global.responseLanguage).toBe('French');
	});
});
