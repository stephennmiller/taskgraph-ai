import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isLoopTrusted, trustLoop } from './loop-trust.js';

describe('files an instruction file imports with @path (#1101)', () => {
	let base: string;
	let home: string;
	let project: string;
	const writeFile = (file: string, text: string) => {
		fs.mkdirSync(path.dirname(path.join(project, file)), { recursive: true });
		fs.writeFileSync(path.join(project, file), text);
	};
	const approve = () => {
		writeFile('.taskgraph/tasks/tasks.json', '{"master":{"tasks":[]}}');
		trustLoop(project, home);
	};

	beforeEach(() => {
		base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tm-trust-')));
		home = path.join(base, 'home');
		project = path.join(base, 'project');
		fs.mkdirSync(home);
		fs.mkdirSync(project);
	});

	afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

	const approveThenChange = (file: string) => {
		writeFile(file, 'Old');
		approve();
		writeFile(file, 'New');
	};

	it.each([
		['CLAUDE.md', 'See @docs/guide.md for the rules'],
		['CLAUDE.md', '@./docs/guide.md'],
		['.taskgraph/CLAUDE.md', '- guide @../docs/guide.md'],
		['.claude/rules/style.md', '@../../docs/guide.md'],
		['.claude/CLAUDE.md', '`@other.md` and @../docs/guide.md'],
		['CLAUDE.md', '```\n@a.md\n```\n@docs/guide.md\n```\n@b.md'],
		// Claude Code parses the Markdown first; each of these is an import to it
		['CLAUDE.md', '@docs/guide.md#rules'],
		['CLAUDE.md', '**@docs/guide.md**'],
		['CLAUDE.md', '[@docs/guide.md](https://example.com)'],
		['CLAUDE.md', '`code`@docs/guide.md'],
		['CLAUDE.md', '```js `a`\n@docs/guide.md'],
		['CLAUDE.md', '<div>\n```\n</div>\n\n@docs/guide.md'],
		['CLAUDE.md', 'text `\n- @docs/guide.md `'],
		// Not imports to Claude Code, but telling them apart takes its parser
		['CLAUDE.md', '`@docs/guide.md`'],
		['CLAUDE.md', 'Example:\n\n```md\n@docs/guide.md\n```\n'],
		['CLAUDE.md', 'Ask me@docs/guide.md']
	])('asks again when the file %s imports as %j changed', (file, text) => {
		writeFile(file, text);

		approveThenChange('docs/guide.md');

		expect(isLoopTrusted(project, home)).toBe(false);
	});

	it('asks again when a file an imported file imports changed, five hops down', () => {
		writeFile('CLAUDE.md', '@docs/1.md');
		for (const n of [1, 2, 3, 4]) writeFile(`docs/${n}.md`, `@${n + 1}.md`);

		approveThenChange('docs/5.md');

		expect(isLoopTrusted(project, home)).toBe(false);
	});

	it('asks again when an imported file that was missing appears', () => {
		writeFile('CLAUDE.md', '@docs/guide.md');
		approve();

		writeFile('docs/guide.md', 'New');

		expect(isLoopTrusted(project, home)).toBe(false);
	});

	it('asks again when a path with a space in it changed', () => {
		writeFile('CLAUDE.md', '@Design\\ Docs/guide.md');

		approveThenChange('Design Docs/guide.md');

		expect(isLoopTrusted(project, home)).toBe(false);
	});

	it('asks again when a file reached five hops down and again directly imports a file that changed', () => {
		writeFile('CLAUDE.md', '@docs/1.md @docs/5.md');
		for (const n of [1, 2, 3, 4]) writeFile(`docs/${n}.md`, `@${n + 1}.md`);
		writeFile('docs/5.md', '@guide.md');

		approveThenChange('docs/guide.md');

		expect(isLoopTrusted(project, home)).toBe(false);
	});

	it('asks again when a rule read after 8 MB of other files imports a file that changed', () => {
		writeFile('.claude/assets.bin', 'x'.repeat(8 * 1024 * 1024));
		writeFile('.claude/rules/style.md', '@../../docs/guide.md');

		approveThenChange('docs/guide.md');

		expect(isLoopTrusted(project, home)).toBe(false);
	});

	it('keeps the approval when the import is a folder', () => {
		writeFile('CLAUDE.md', '@docs');

		approveThenChange('docs/guide.md');

		expect(isLoopTrusted(project, home)).toBe(true);
	});

	it('reads nothing outside the repository, by path or by link', () => {
		fs.mkdirSync(path.join(project, '.git'));
		const outside = path.join(base, 'outside.md');
		fs.symlinkSync(outside, path.join(project, 'link.md'));
		fs.symlinkSync(base, path.join(project, 'up'));
		writeFile(
			'CLAUDE.md',
			`@../outside.md @${outside} @link.md @up/outside.md @~/outside.md`
		);
		fs.writeFileSync(path.join(home, 'outside.md'), 'Old');
		fs.writeFileSync(outside, 'Old');
		approve();

		fs.writeFileSync(outside, 'New');
		fs.writeFileSync(path.join(home, 'outside.md'), 'New');

		expect(isLoopTrusted(project, home)).toBe(true);
	});

	it('ends on files that import each other', () => {
		writeFile('CLAUDE.md', '@a.md');
		writeFile('a.md', '@b.md');
		writeFile('b.md', '@a.md @CLAUDE.md');
		approve();

		expect(isLoopTrusted(project, home)).toBe(true);
	});
});
