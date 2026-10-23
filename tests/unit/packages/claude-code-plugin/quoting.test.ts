/**
 * Plugin commands, agents and skills tell Claude which taskgraph command to
 * run. Free text (a prompt, a note, a title) goes into those commands, and
 * inside double quotes the shell runs backticks and $(...) in it, so a note
 * that quotes `src/a.ts` would try to run src/a.ts. Free text goes in single
 * quotes, and $ARGUMENTS (the user's raw text) never goes into a command.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../../../..'
);
const pluginDir = path.join(repoRoot, 'packages/claude-code-plugin');

const markdownFiles = (dir: string): string[] =>
	fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) return markdownFiles(full);
		return entry.name.endsWith('.md') ? [full] : [];
	});

/** Plugin markdown Claude reads, plus the AGENTS.md that init writes */
const instructionFiles = [
	...['commands', 'agents', 'skills'].flatMap((dir) =>
		markdownFiles(path.join(pluginDir, dir))
	),
	path.join(repoRoot, 'assets/AGENTS.md')
].map((file) => path.relative(repoRoot, file));

/**
 * Each `taskgraph ...` call in a file: lines in fenced code blocks that start
 * with it, and inline code spans that start with it. Only the taskgraph part
 * is kept: a comment, or a command after `||`, `&&`, `|` or `;`, is dropped.
 */
function taskgraphCalls(markdown: string): string[] {
	const calls: string[] = [];
	let inFence = false;
	for (const line of markdown.split('\n')) {
		if (line.trim().startsWith('```')) {
			inFence = !inFence;
			continue;
		}
		if (inFence) {
			const match = line.match(/^\s*(?:\$ )?(taskgraph .*)$/);
			if (match) calls.push(match[1]);
			continue;
		}
		for (const span of line.matchAll(/`(taskgraph [^`]*)`/g)) {
			calls.push(span[1]);
		}
	}
	return calls.map((call) => {
		// Cut at the first shell operator or comment outside single quotes
		let inQuote = false;
		for (let i = 0; i < call.length; i++) {
			const char = call[i];
			if (char === "'") inQuote = !inQuote;
			else if (!inQuote && /[#|;&]/.test(char)) return call.slice(0, i).trim();
		}
		return call.trim();
	});
}

/** The parts of a call the shell would expand: everything outside '...' */
const unquoted = (call: string): string => call.replace(/'[^']*'/g, "''");

describe('taskgraphCalls', () => {
	it('reads fenced lines and inline code spans', () => {
		expect(
			taskgraphCalls(
				"Run `taskgraph note 3 'x'` then:\n```bash\ntaskgraph next # pick\n```"
			)
		).toEqual(["taskgraph note 3 'x'", 'taskgraph next']);
	});

	it('keeps operators inside single quotes', () => {
		expect(
			taskgraphCalls('```bash\ntaskgraph note 3 \'a | b # c\' || echo "x"\n```')
		).toEqual(["taskgraph note 3 'a | b # c'"]);
	});

	it('ignores fenced lines that do not start with taskgraph', () => {
		expect(taskgraphCalls('```bash\necho "taskgraph note 3 x"\n```')).toEqual(
			[]
		);
	});
});

describe('free text passed to taskgraph in plugin instructions', () => {
	it('finds the files and the calls in them', () => {
		expect(instructionFiles).toContain(
			'packages/claude-code-plugin/commands/update-task.md'
		);
		expect(instructionFiles).toContain(
			'packages/claude-code-plugin/agents/task-executor.md'
		);
		expect(instructionFiles).toContain(
			'packages/claude-code-plugin/skills/taskgraph/SKILL.md'
		);
		expect(instructionFiles).toContain('assets/AGENTS.md');
		const calls = instructionFiles.flatMap((file) =>
			taskgraphCalls(fs.readFileSync(path.join(repoRoot, file), 'utf-8'))
		);
		expect(calls.length).toBeGreaterThan(50);
	});

	it('flags a double-quoted prompt', () => {
		const calls = taskgraphCalls(
			'```bash\ntaskgraph update-task --id=<id> --prompt="<context>"\n```'
		);

		expect(calls.filter((call) => unquoted(call).includes('"'))).toHaveLength(
			1
		);
	});

	it.each(instructionFiles)('%s never double-quotes text it passes', (file) => {
		const calls = taskgraphCalls(
			fs.readFileSync(path.join(repoRoot, file), 'utf-8')
		);

		expect(calls.filter((call) => unquoted(call).includes('"'))).toEqual([]);
	});

	it.each(instructionFiles)(
		'%s never puts $ARGUMENTS into a taskgraph call',
		(file) => {
			const calls = taskgraphCalls(
				fs.readFileSync(path.join(repoRoot, file), 'utf-8')
			);

			expect(calls.filter((call) => call.includes('$ARGUMENTS'))).toEqual([]);
		}
	);

	it.each(instructionFiles)(
		"%s says how to write ' when it single-quotes text",
		(file) => {
			const body = fs.readFileSync(path.join(repoRoot, file), 'utf-8');
			const quotesText = taskgraphCalls(body).some((call) =>
				/'<[^>]+>'/.test(call)
			);

			if (quotesText) expect(body).toContain("`'\\''`");
		}
	);
});

// to-done has this check with its other tests in packages/tm-profiles/tests/integration/plugin-commands.test.ts
describe('commands that take a task ID from the arguments', () => {
	it.each([
		'clear-subtasks',
		'expand-task',
		'remove-task',
		'set-status',
		'to-in-progress',
		'update-task',
		'update-tasks-from-id'
	])('%s uses the ID only when it is a task number', (name) => {
		const body = fs.readFileSync(
			path.join(pluginDir, 'commands', `${name}.md`),
			'utf-8'
		);

		expect(body).toContain('only when it is digits and dots');
	});
});
