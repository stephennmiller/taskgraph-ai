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
	return calls.map((call) => shellScan(call).call);
}

/**
 * Reads a call the way the shell does: text in '...' is literal, and outside
 * quotes a backslash makes the next character literal (so `'\''` is a quote).
 * Returns the call cut at the first comment or shell operator outside quotes,
 * and the text of that call the shell would expand (outside quotes and escapes).
 */
function shellScan(call: string): { call: string; unquoted: string } {
	let inQuote = false;
	let unquoted = '';
	for (let i = 0; i < call.length; i++) {
		const char = call[i];
		if (inQuote) {
			if (char === "'") inQuote = false;
		} else if (char === "'") {
			inQuote = true;
		} else if (char === '\\') {
			i++;
		} else if (/[#|;&]/.test(char)) {
			return { call: call.slice(0, i).trim(), unquoted };
		} else {
			unquoted += char;
		}
	}
	return { call: call.trim(), unquoted };
}

/** The parts of a call the shell would expand: everything outside '...' */
const unquoted = (call: string): string => shellScan(call).unquoted;

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

	it("reads '\\'' as a quote inside single-quoted text", () => {
		const [call] = taskgraphCalls(
			"```bash\ntaskgraph note 3 'it'\\''s a | b \"x\"' || true\n```"
		);

		expect(call).toBe("taskgraph note 3 'it'\\''s a | b \"x\"'");
		expect(unquoted(call)).toBe('taskgraph note 3 ');
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

/** A taskgraph call that puts a task ID placeholder into the command line */
const takesId = (call: string): boolean =>
	/(--(id|parent|from|task-id|depends-on)=<|^taskgraph (why|show|note) <)/.test(
		call
	);

/** The fenced lines of a file only, so prose that mentions a command is skipped */
const fencedCalls = (markdown: string): string[] =>
	taskgraphCalls(markdown.replace(/^(?!```|\s*(?:\$ )?taskgraph ).*$/gm, ''));

/**
 * Commands that take a task ID from the user's arguments: the argument hint
 * names one, or a code block puts an ID placeholder into a taskgraph call
 */
const idCommands = fs
	.readdirSync(path.join(pluginDir, 'commands'))
	.filter((file) => {
		const body = fs.readFileSync(
			path.join(pluginDir, 'commands', file),
			'utf-8'
		);
		return (
			/^argument-hint: .*\b(task[ -])?id\b/im.test(body) ||
			fencedCalls(body).some(takesId)
		);
	});

describe('commands that take a task ID from the arguments', () => {
	it('finds them', () => {
		expect(idCommands).toEqual(
			expect.arrayContaining(['expand.md', 'set-status.md', 'why.md'])
		);
	});

	it.each(idCommands)(
		'%s uses the ID only when it is a task number',
		(file) => {
			const body = fs.readFileSync(
				path.join(pluginDir, 'commands', file),
				'utf-8'
			);

			expect(body).toMatch(/only when (it is|they are) digits and dots/);
		}
	);
});
