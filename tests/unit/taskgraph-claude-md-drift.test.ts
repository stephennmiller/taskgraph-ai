/**
 * Guards the TaskGraph agent guide against drift from the code.
 *
 * The guide names CLI commands, MCP tools and slash commands by hand. This
 * extracts those names and asserts each one is registered, so a rename or
 * removal fails CI instead of silently misleading agents. It checks both the
 * repo's own .taskgraph/CLAUDE.md and assets/AGENTS.md, the copy `init` ships
 * to users.
 *
 * Lives in the legacy root suite because it needs both the legacy Commander
 * program (scripts/) and the MCP tool registry (mcp-server/). Slash commands
 * are checked against the plugin's command files.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	coreTools,
	getToolCounts,
	standardTools,
	toolRegistry
} from '../../mcp-server/src/tools/tool-registry.js';
import { setupCLI } from '../../scripts/modules/commands.js';

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

/** Registered tool names in backticks on the first matching line that has any. */
function listedOn(markdown: string, marker: RegExp): string[] {
	for (const line of markdown.split('\n')) {
		if (!marker.test(line)) continue;
		const names = [...line.matchAll(/`([a-z][a-z_-]*)`/g)]
			.map((m) => m[1])
			.filter((n) => Object.hasOwn(toolRegistry, n));
		if (names.length) return unique(names);
	}
	return [];
}

// Strip a trailing `# note`, but keep `// = taskgraph <cmd>` (it names a command)
const stripComment = (s: string) =>
	s.replace(/\s+#.*$/, '').replace(/\s+\/\/(?!\s*=\s*taskgraph\b).*$/, '');

describe.each(DOCS)('%s', (docPath) => {
	const doc = fs.readFileSync(path.join(rootDir, docPath), 'utf8');
	const spans = codeSpans(doc);

	const cliCommands = unique(
		spans
			.map(stripComment)
			.flatMap((s) =>
				[...s.matchAll(/(?:^|[\s"'(`=])taskgraph\s+([a-z][a-z-]*)/g)].map(
					(m) => m[1]
				)
			)
	);

	// snake_case identifiers in backticks, plus the `name; // = ...` list of the
	// "Essential MCP Tools" block (single words like `update` appear there)
	const mcpTools = unique([
		...spans.filter((s) => /^[a-z]+(_[a-z]+)+$/.test(s)),
		...spans.flatMap((s) => {
			const m = s.match(/^([a-z_]+);\s*\/\/ =/);
			return m ? [m[1]] : [];
		})
	]);

	const slashCommands = unique(
		spans.flatMap((s) =>
			[...s.matchAll(/\/taskgraph:([a-z][a-z-]*)/g)].map((m) => m[1])
		)
	);

	it('extracts something to check (guards the extraction itself)', () => {
		expect(cliCommands.length).toBeGreaterThan(10);
		expect(mcpTools.length).toBeGreaterThan(10);
		expect(slashCommands.length).toBeGreaterThan(5);
	});

	it('only names CLI commands the program registers (or their aliases)', () => {
		const registered = new Set(
			setupCLI().commands.flatMap((c) => [c.name(), ...c.aliases()])
		);
		expect(cliCommands.filter((c) => !registered.has(c))).toEqual([]);
	});

	it('only names MCP tools the registry registers', () => {
		const missing = mcpTools.filter((t) => !Object.hasOwn(toolRegistry, t));
		expect(missing).toEqual([]);
	});

	it('only names slash commands the plugin ships', () => {
		expect(slashCommands.filter((c) => !pluginCommands.has(c))).toEqual([]);
	});

	it('states tool tier counts that match the registry', () => {
		const counts = getToolCounts();
		const core = doc.match(/\|\s*`core`\s*\|\s*(\d+)\s*\|/);
		const standard = doc.match(/\|\s*`standard`\s*\|\s*(\d+)\s*\|/);
		const all = doc.match(/\|\s*`all`\s*\|\s*(\d+)(\+?)\s*\|/);
		expect(Number(core?.[1])).toBe(counts.core);
		expect(Number(standard?.[1])).toBe(counts.standard);
		if (all?.[2] === '+') {
			expect(Number(all[1])).toBeLessThanOrEqual(counts.total);
		} else {
			expect(Number(all?.[1])).toBe(counts.total);
		}
	});

	it('lists the same core and standard tools as the registry', () => {
		const listedCore = listedOn(doc, /Core tools|\|\s*`core`/);
		const listedStandard = listedOn(doc, /Standard adds|\|\s*`standard`/);
		const extra = standardTools.filter((t) => !coreTools.includes(t));
		expect(listedCore).toEqual(unique(coreTools));
		expect(listedStandard).toEqual(unique(extra));
	});
});

describe('other places that state the tool tier counts', () => {
	const read = (file: string) =>
		fs.readFileSync(path.join(rootDir, file), 'utf8');

	it('README tier table and setup text match the registry', () => {
		const readme = read('README.md');
		const counts = getToolCounts();
		const row = (tier: string) =>
			Number(
				readme.match(
					new RegExp(`\\|\\s*\`${tier}\`[^|]*\\|\\s*(\\d+)\\s*\\|`)
				)?.[1]
			);
		expect(row('standard')).toBe(counts.standard);
		expect(row('all')).toBe(counts.total);
		expect(Number(readme.match(/`standard` loads (\d+) tools/)?.[1])).toBe(
			counts.standard
		);
	});

	it('llms-install.md states the standard tier count', () => {
		const text = read('llms-install.md');
		expect(Number(text.match(/`standard` \((\d+)\)/)?.[1])).toBe(
			getToolCounts().standard
		);
	});
});
