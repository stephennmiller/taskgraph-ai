/**
 * @fileoverview Keeps the build-comparison scenarios (tests/parity/scenarios)
 * honest: every file is a valid scenario, the README names it, and the Phase 1
 * commands and MCP tools each appear in at least one.
 *
 * @integration
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateScenario } from '../parity/compare-builds.mjs';

const parity = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../parity'
);
const scenarioDir = path.join(parity, 'scenarios');
const files = fs.readdirSync(scenarioDir).filter((f) => f.endsWith('.json'));
const scenarios = files.map((file) => ({
	file,
	scenario: JSON.parse(fs.readFileSync(path.join(scenarioDir, file), 'utf8'))
}));
const readme = fs.readFileSync(path.join(parity, 'README.md'), 'utf8');

const PHASE1_TOOLS = [
	'add_dependency',
	'remove_dependency',
	'validate_dependencies',
	'fix_dependencies',
	'clear_subtasks',
	'remove_task',
	'remove_subtask',
	'add_subtask',
	'move_task',
	'list_tags',
	'use_tag',
	'add_tag',
	'delete_tag',
	'rename_tag',
	'copy_tag'
];
const PHASE1_COMMANDS = [
	'add-dependency',
	'remove-dependency',
	'validate-dependencies',
	'fix-dependencies',
	'clear-subtasks',
	'remove-task',
	'remove-subtask',
	'add-subtask',
	'move',
	'add-tag',
	'use-tag',
	'rename-tag',
	'copy-tag',
	'delete-tag'
];
const PHASE1_TAGS_SUBCOMMANDS = [
	'list',
	'add',
	'use',
	'remove',
	'rename',
	'copy'
];

type Step = {
	args?: string[];
	mcp?: string;
	expectExit?: number;
	expectError?: boolean;
};
const steps = (s: unknown): Step[] =>
	(s as { steps: unknown[] }).steps.map((x) =>
		Array.isArray(x) ? { args: x as string[] } : (x as Step)
	);
const allSteps = scenarios.flatMap(({ scenario }) => steps(scenario));

describe('parity scenarios', () => {
	it('has scenario files to check', () => {
		expect(files.length).toBeGreaterThan(0);
	});

	it.each(scenarios)('$file is a valid scenario', ({ scenario }) => {
		expect(() => validateScenario(scenario)).not.toThrow();
	});

	it.each(files)('README names %s', (file) => {
		expect(readme).toContain(`\`${file}\``);
	});

	it.each(scenarios.filter(({ scenario }) => scenario.fixture))(
		'$file points at a fixture that exists',
		({ scenario }) => {
			expect(fs.existsSync(path.resolve(scenarioDir, scenario.fixture))).toBe(
				true
			);
		}
	);

	it.each(PHASE1_TOOLS)('MCP tool %s is called by a scenario', (tool) => {
		expect(allSteps.some((s) => s.mcp === tool && !s.expectError)).toBe(true);
	});

	it.each(PHASE1_COMMANDS)('command %s runs in a scenario', (command) => {
		expect(allSteps.some((s) => s.args?.[0] === command && !s.expectExit)).toBe(
			true
		);
	});

	it.each([...PHASE1_TOOLS, ...PHASE1_COMMANDS])(
		'the README coverage table names %s',
		(name) => {
			expect(readme).toContain(`\`${name}\``);
		}
	);

	it.each(PHASE1_TAGS_SUBCOMMANDS)('tags %s runs in a scenario', (sub) => {
		expect(
			allSteps.some(
				(s) => s.args?.[0] === 'tags' && (s.args[1] ?? 'list') === sub
			)
		).toBe(true);
	});
});
