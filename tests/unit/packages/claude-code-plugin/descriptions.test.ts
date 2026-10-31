/**
 * Claude picks a plugin command, agent or skill from its description alone,
 * so each one has to say it's about TaskGraph and when to use it. Generic
 * descriptions ("List tasks with intelligent argument parsing") never match.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';

const pluginDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../../../../packages/claude-code-plugin'
);

/** The `description:` value from a markdown file's front matter */
function description(file: string): string {
	const text = fs.readFileSync(file, 'utf8');
	const front = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
	const line = front.match(/^description:\s*(.*)$/m)?.[1] ?? '';
	return line.replace(/^"(.*)"$/, '$1');
}

const commandFiles = fs
	.readdirSync(path.join(pluginDir, 'commands'))
	.filter((file) => file.endsWith('.md'));

const frontMatterFiles = [
	...commandFiles.map((file) => `commands/${file}`),
	...fs.readdirSync(path.join(pluginDir, 'agents')).map((f) => `agents/${f}`),
	'skills/taskgraph/SKILL.md',
	'skills/research/SKILL.md'
];

// Claude Code reads front matter leniently, but the plugin directory's scanner
// is strict YAML: an unquoted `: ` in a value made it reject both agents
describe('plugin front matter', () => {
	it.each(frontMatterFiles)('%s is valid YAML', (file) => {
		const text = fs.readFileSync(path.join(pluginDir, file), 'utf8');
		const front = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';

		expect(load(front)).toHaveProperty('description');
	});
});

describe('plugin command descriptions', () => {
	it.each(commandFiles)('%s leads with TaskGraph and stays short', (file) => {
		const text = description(path.join(pluginDir, 'commands', file));

		expect(text).toMatch(/^TaskGraph: [a-z]/);
		expect(text.length).toBeLessThanOrEqual(110);
	});

	it.each([
		['next', /what to do next/],
		['list', /what tasks there are/],
		['show', /task ID/]
	])('%s says when to use it', (name, trigger) => {
		expect(description(path.join(pluginDir, 'commands', `${name}.md`))).toMatch(
			trigger
		);
	});
});

describe('plugin taskgraph skill', () => {
	const file = path.join(pluginDir, 'skills/taskgraph/SKILL.md');
	const text = fs.readFileSync(file, 'utf8');

	it('is named taskgraph and triggers on planning talk in a TaskGraph repo', () => {
		expect(text).toMatch(/^---\nname: taskgraph\n/);
		const desc = description(file);
		expect(desc).toContain('.taskgraph/');
		expect(desc).toMatch(/what to work on next/);
		expect(desc).toMatch(/plan/);
	});

	it('sends Claude to taskgraph prime for the rules', () => {
		expect(text).toContain('`taskgraph prime`');
	});
});

describe('plugin task-executor agent', () => {
	it('is scoped to TaskGraph task IDs', () => {
		const desc = description(path.join(pluginDir, 'agents/task-executor.md'));

		expect(desc).toContain('TaskGraph task ID');
		expect(desc).toContain(
			'not for implementation requests that name no TaskGraph task'
		);
	});
});
