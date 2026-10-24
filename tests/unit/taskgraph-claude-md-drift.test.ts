/**
 * Guards the TaskGraph agent guide and the `taskgraph prime` rules against
 * drift from the code.
 *
 * The guide (repo's .taskgraph/CLAUDE.md and assets/AGENTS.md, the copy
 * `init` ships to users) and the prime rules name CLI commands, flags, MCP
 * tools and slash commands by hand. This extracts those names and asserts
 * each one is registered, so a rename or removal fails CI instead of silently
 * misleading agents.
 *
 * Lives in the legacy root suite because it needs both the Commander program
 * (apps/cli) and the MCP tool registry (apps/mcp/). Slash commands
 * are checked against the plugin's command files.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';
import {
	standardTools,
	toolRegistry
} from '../../apps/mcp/src/tools/tool-registry.js';
import { PRIME_RULES } from '../../packages/tm-core/src/modules/tasks/utils/prime-context.js';
import { setupCLI } from '../../apps/cli/src/program.js';

const rootDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../..'
);

const DOCS = ['.taskgraph/CLAUDE.md', 'assets/AGENTS.md'];

// The plugin is the only slash-command channel: one markdown file per command
const pluginCommands = new Set(
	fs
		.readdirSync(path.join(rootDir, 'packages/claude-code-plugin/commands'))
		.filter((file) => file.endsWith('.md'))
		.map((file) => file.slice(0, -3))
);

const program = setupCLI();
const commandsByName = new Map<string, Command>(
	program.commands.flatMap((c) =>
		[c.name(), ...c.aliases()].map((name) => [name, c] as const)
	)
);

/** Text inside fenced blocks and inline backticks, one entry per span/line. */
function codeSpans(markdown: string): string[] {
	const spans: string[] = [];
	let inFence = false;
	for (const line of markdown.split('\n')) {
		if (line.trimStart().startsWith('```')) {
			inFence = !inFence;
			continue;
		}
		if (inFence) {
			spans.push(line);
			continue;
		}
		for (const m of line.matchAll(/`([^`]+)`/g)) spans.push(m[1]);
	}
	return spans;
}

function unique(values: string[]): string[] {
	return [...new Set(values)].sort();
}

// Strip a trailing `# note`, but keep `// = taskgraph <cmd>` (it names a command)
const stripComment = (s: string) =>
	s.replace(/\s+#.*$/, '').replace(/\s+\/\/(?!\s*=\s*taskgraph\b).*$/, '');

/** `taskgraph <command> --flag …` invocations in a line of code */
function invocations(
	line: string
): Array<{ command: string; flags: string[] }> {
	return [
		...stripComment(line).matchAll(
			/(?:^|[\s"'(`=])taskgraph\s+([a-z][a-z-]*)((?:\s+[^\s|;&]+)*)/g
		)
	].map((m) => ({
		command: m[1],
		flags: [...m[2].matchAll(/(?:^|\s)(--[a-z][a-z-]*)/g)].map((f) => f[1])
	}));
}

/** Flags a command doesn't define, as `command --flag` */
function unknownFlags(calls: ReturnType<typeof invocations>): string[] {
	return calls.flatMap(({ command, flags }) => {
		const cmd = commandsByName.get(command);
		if (!cmd) return [];
		const known = new Set<string | undefined>(cmd.options.map((o) => o.long));
		known.add('--help');
		return flags.filter((f) => !known.has(f)).map((f) => `${command} ${f}`);
	});
}

describe.each(DOCS)('%s', (docPath) => {
	const doc = fs.readFileSync(path.join(rootDir, docPath), 'utf8');
	const spans = codeSpans(doc);
	const calls = spans.flatMap(invocations);
	const cliCommands = unique(calls.map((c) => c.command));

	const mcpTools = unique(spans.filter((s) => /^[a-z]+(_[a-z]+)+$/.test(s)));

	const slashCommands = unique(
		spans.flatMap((s) =>
			[...s.matchAll(/\/taskgraph:([a-z][a-z-]*)/g)].map((m) => m[1])
		)
	);

	it('points agents at taskgraph prime (guards the extraction too)', () => {
		expect(cliCommands).toContain('prime');
		expect(cliCommands.length).toBeGreaterThanOrEqual(5);
	});

	it('stays short: prime carries the workflow rules', () => {
		expect(doc.trim().split('\n').length).toBeLessThanOrEqual(20);
	});

	it('only names CLI commands the program registers (or their aliases)', () => {
		expect(cliCommands.filter((c) => !commandsByName.has(c))).toEqual([]);
	});

	it('only uses flags those commands define', () => {
		expect(unknownFlags(calls)).toEqual([]);
	});

	it('only names MCP tools the registry registers', () => {
		const missing = mcpTools.filter((t) => !Object.hasOwn(toolRegistry, t));
		expect(missing).toEqual([]);
	});

	it('only names slash commands the plugin ships', () => {
		expect(slashCommands.filter((c) => !pluginCommands.has(c))).toEqual([]);
	});
});

describe('taskgraph prime rules', () => {
	const calls = PRIME_RULES.flatMap((rule) => [
		...invocations(rule.text),
		...invocations(rule.command)
	]);

	it('name four taskgraph commands across the rules (guards the extraction)', () => {
		expect(calls.map((c) => c.command)).toEqual([
			'set-status',
			'note',
			'add-task',
			'set-status'
		]);
	});

	it('only name CLI commands the program registers', () => {
		expect(
			calls.map((c) => c.command).filter((c) => !commandsByName.has(c))
		).toEqual([]);
	});

	it('only use flags those commands define', () => {
		expect(unknownFlags(calls)).toEqual([]);
	});
});

describe('the plugin skill and hooks', () => {
	const skill = fs.readFileSync(
		path.join(rootDir, 'packages/claude-code-plugin/skills/taskgraph/SKILL.md'),
		'utf8'
	);
	const hooks = JSON.parse(
		fs.readFileSync(
			path.join(rootDir, 'packages/claude-code-plugin/hooks/hooks.json'),
			'utf8'
		)
	);
	const hookCommands: string[] = Object.values(hooks.hooks).flatMap(
		(entries: any) =>
			entries.flatMap((e: any) => e.hooks.map((h: any) => h.command))
	);
	const calls = [
		...codeSpans(skill).flatMap(invocations),
		...hookCommands.flatMap(invocations)
	];

	it('name taskgraph commands (guards the extraction)', () => {
		const names = unique(calls.map((c) => c.command));
		expect(names).toEqual(expect.arrayContaining(['prime', 'next', 'note']));
		expect(calls).toContainEqual({
			command: 'prime',
			flags: ['--project', '--unnoted-since']
		});
	});

	it('only name CLI commands the program registers', () => {
		expect(
			calls.map((c) => c.command).filter((c) => !commandsByName.has(c))
		).toEqual([]);
	});

	it('only use flags those commands define', () => {
		expect(unknownFlags(calls)).toEqual([]);
	});
});

describe('other places that state the tool tier counts', () => {
	const read = (file: string) =>
		fs.readFileSync(path.join(rootDir, file), 'utf8');

	it('README tier table and setup text match the registry', () => {
		const readme = read('README.md');
		const row = (tier: string) =>
			Number(
				readme.match(
					new RegExp(`\\|\\s*\`${tier}\`[^|]*\\|\\s*(\\d+)\\s*\\|`)
				)?.[1]
			);
		expect(row('standard')).toBe(standardTools.length);
		expect(row('all')).toBe(Object.keys(toolRegistry).length);
		expect(Number(readme.match(/`standard` loads (\d+) tools/)?.[1])).toBe(
			standardTools.length
		);
	});

	it('llms-install.md states the standard tier count', () => {
		const text = read('llms-install.md');
		expect(Number(text.match(/`standard` \((\d+)\)/)?.[1])).toBe(
			standardTools.length
		);
	});
});
