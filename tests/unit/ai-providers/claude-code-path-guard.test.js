import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import {
	createPathGuardHook,
	excludeSecretsFromGrep,
	getPathViolation,
	isInsideRoot
} from '../../../src/ai-providers/claude-code-path-guard.js';

const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../../..'
);

/**
 * The ripgrep Claude Code's Grep runs: the Claude Code binary acts as rg when
 * started with argv0 `rg`. Falls back to rg on PATH.
 */
function findRipgrep() {
	const exe = process.platform === 'win32' ? 'claude.exe' : 'claude';
	const platform = `${process.platform}-${process.arch}`;
	for (const pkg of [
		`claude-agent-sdk-${platform}`,
		`claude-code-${platform}`
	]) {
		const bin = path.join(repoRoot, 'node_modules/@anthropic-ai', pkg, exe);
		if (fs.existsSync(bin)) return { command: bin, args: ['--no-config'] };
	}
	const probe = spawnSync('rg', ['--version']);
	return probe.status === 0 ? { command: 'rg', args: [] } : null;
}

/**
 * The rg arguments Claude Code (2.1.x) builds for a Grep call in content
 * mode: --hidden, then each `glob` token as --glob. Tokens split on spaces,
 * then on commas unless the token holds a brace group.
 */
function grepArgs({ pattern, glob, type }) {
	const args = ['--hidden', '--no-heading', '-n'];
	for (const token of (glob ?? '').split(/\s+/).filter(Boolean)) {
		const parts =
			token.includes('{') && token.includes('}') ? [token] : token.split(',');
		for (const part of parts.filter(Boolean)) args.push('--glob', part);
	}
	if (type) args.push('--type', type);
	// rg reads stdin when given no path, so name the directory like Claude Code
	args.push('-e', pattern, '.');
	return args;
}

const ripgrep = findRipgrep();

/** Lines a Grep call returns when run from cwd */
function runGrep(cwd, input) {
	const result = spawnSync(
		ripgrep.command,
		[...ripgrep.args, ...grepArgs(input)],
		{ cwd, argv0: 'rg', encoding: 'utf8' }
	);
	if (result.status !== 0 && result.status !== 1) {
		throw new Error(`ripgrep failed: ${result.stderr || result.error}`);
	}
	return result.stdout.split('\n').filter(Boolean).sort();
}

describe('claude-code path guard', () => {
	let base;
	let root;
	let outside;

	beforeAll(() => {
		base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tg-guard-')));
		root = path.join(base, 'project');
		outside = path.join(base, 'secret.txt');
		fs.mkdirSync(path.join(root, 'src'), { recursive: true });
		fs.writeFileSync(outside, 'x');
		fs.symlinkSync(outside, path.join(root, 'link.txt'));
	});

	afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

	it('allows paths inside the root, relative or absolute', () => {
		expect(isInsideRoot(root, 'src/a.js')).toBe(true);
		expect(isInsideRoot(root, path.join(root, 'src'))).toBe(true);
		expect(isInsideRoot(root, root)).toBe(true);
	});

	it('rejects absolute paths, .. traversal and home paths outside the root', () => {
		expect(isInsideRoot(root, outside)).toBe(false);
		expect(isInsideRoot(root, '../secret.txt')).toBe(false);
		expect(isInsideRoot(root, '~/.ssh/id_rsa')).toBe(false);
		expect(isInsideRoot(root, path.join(base, 'project-evil/x'))).toBe(false);
	});

	it('rejects symlinks that point outside the root', () => {
		expect(isInsideRoot(root, 'link.txt')).toBe(false);
	});

	it('checks Read file_path and Grep/Glob path', () => {
		expect(getPathViolation(root, 'Read', { file_path: outside })).toMatch(
			/outside/
		);
		expect(
			getPathViolation(root, 'Read', { file_path: 'src/a.js' })
		).toBeNull();
		expect(
			getPathViolation(root, 'Grep', { pattern: 'x', path: base })
		).toMatch(/outside/);
		expect(getPathViolation(root, 'Grep', { pattern: '../x' })).toBeNull(); // regex
		expect(getPathViolation(root, 'Glob', { pattern: '**/*.js' })).toBeNull();
	});

	it('rejects glob patterns that leave the root', () => {
		expect(getPathViolation(root, 'Glob', { pattern: '../**/*' })).toMatch(
			/may not leave/
		);
		expect(getPathViolation(root, 'Glob', { pattern: '/etc/*' })).toMatch(
			/may not leave/
		);
	});

	it('checks plain absolute Glob paths from their parent, trailing slash or not', () => {
		// Without glob characters Claude Code searches dirname(pattern)
		expect(getPathViolation(root, 'Glob', { pattern: `${root}/` })).toMatch(
			/may not leave/
		);
		expect(getPathViolation(root, 'Glob', { pattern: root })).toMatch(
			/may not leave/
		);
		expect(
			getPathViolation(root, 'Glob', { pattern: `${root}/src/a.js` })
		).toBeNull();
	});

	it('checks the directory an absolute glob is searched from', () => {
		// Claude Code searches `${base}/project*` from `${base}`, not from root
		expect(getPathViolation(root, 'Glob', { pattern: `${root}*/**` })).toMatch(
			/may not leave/
		);
		expect(getPathViolation(root, 'Glob', { pattern: `${root}?x/*` })).toMatch(
			/may not leave/
		);
		expect(
			getPathViolation(root, 'Glob', { pattern: `${root}/src/*.js` })
		).toBeNull();
		expect(
			getPathViolation(root, 'Glob', { pattern: `${root}/**` })
		).toBeNull();
	});

	it('treats Windows drive and UNC globs as absolute', () => {
		expect(
			getPathViolation(root, 'Glob', { pattern: 'C:/Users/me/.ssh/**' })
		).toEqual(
			process.platform === 'win32'
				? expect.stringMatching(/may not leave/)
				: null
		);
		expect(
			getPathViolation(root, 'Glob', { pattern: '\\\\server\\share\\*' })
		).toEqual(
			process.platform === 'win32'
				? expect.stringMatching(/may not leave/)
				: null
		);
	});

	it('allows names inside the root that start with two dots', () => {
		expect(isInsideRoot(root, '..config')).toBe(true);
		expect(isInsideRoot(root, path.join(root, '..cache', 'x'))).toBe(true);
	});

	it("leaves Grep's regex and glob alone, since both only filter under its path", () => {
		expect(
			getPathViolation(root, 'Grep', { pattern: '/etc/*', glob: '*.js' })
		).toBeNull();
		// `/src/**` is rg's form for anchoring to the search root
		expect(
			getPathViolation(root, 'Grep', { pattern: 'x', glob: '/src/**' })
		).toBeNull();
		expect(
			getPathViolation(root, 'Grep', { pattern: 'x', glob: '../*', path: base })
		).toMatch(/outside/);
	});

	describe('secret files inside the project', () => {
		it.each([
			['.env'],
			['.env.local'],
			['config/.env.production'],
			['.git/config'],
			['keys/server.pem'],
			['.ssh/id_ed25519'],
			['.npmrc']
		])('denies Read of %s', (file) => {
			expect(getPathViolation(root, 'Read', { file_path: file })).toMatch(
				/secret/
			);
		});

		it.each([['**/.env*'], ['.git/**'], ['**/*.pem'], ['id_rsa*']])(
			'denies Glob pattern %s',
			(pattern) => {
				expect(getPathViolation(root, 'Glob', { pattern })).toMatch(/secret/);
			}
		);

		it('denies a Grep aimed at a secret file or directory', () => {
			expect(
				getPathViolation(root, 'Grep', { pattern: 'x', path: '.git' })
			).toMatch(/secret/);
		});

		it('denies upper-case names on case-insensitive filesystems', () => {
			expect(getPathViolation(root, 'Read', { file_path: '.ENV' })).toMatch(
				/secret/
			);
		});

		it('denies a symlink that points at a secret file', () => {
			fs.writeFileSync(path.join(root, '.env'), 'KEY=1');
			fs.symlinkSync(path.join(root, '.env'), path.join(root, 'notes.txt'));
			expect(
				getPathViolation(root, 'Read', { file_path: 'notes.txt' })
			).toMatch(/secret/);
		});

		it('only judges the part of the path below the root', () => {
			const odd = path.join(base, 'id_cards', 'app');
			fs.mkdirSync(odd, { recursive: true });
			expect(
				getPathViolation(odd, 'Read', { file_path: path.join(odd, 'a.js') })
			).toBeNull();
		});

		it('allows source files whose names merely start with id_', () => {
			expect(
				getPathViolation(root, 'Read', { file_path: 'src/id_utils.js' })
			).toBeNull();
		});

		it('denies brace patterns and Grep globs that name a secret', () => {
			expect(getPathViolation(root, 'Glob', { pattern: '{.env,x}' })).toMatch(
				/secret/
			);
			expect(
				getPathViolation(root, 'Grep', { pattern: 'KEY', glob: '.env*' })
			).toMatch(/secret/);
		});

		it.each([['src/a.js'], ['.env.example'], ['docs/environment.md']])(
			'still allows %s',
			(file) => {
				expect(getPathViolation(root, 'Read', { file_path: file })).toBeNull();
			}
		);
	});

	describe('directory-wide Grep (#225)', () => {
		let project;
		const secrets = [
			'.env',
			'.env.local',
			'.ENV',
			'config/.env.production',
			'.npmrc',
			'.ssh/id_rsa',
			'.ssh/id_ed25519.pub',
			'certs/server.pem',
			'.git/config'
		];

		beforeAll(() => {
			project = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-grep-'));
			for (const file of [...secrets, 'src/app.js', 'README.md']) {
				fs.mkdirSync(path.dirname(path.join(project, file)), {
					recursive: true
				});
				fs.writeFileSync(path.join(project, file), `API_KEY=${file}\n`);
			}
			// rg doesn't follow links while walking, so this stays unread too
			fs.symlinkSync('.env', path.join(project, 'notes.txt'));
		});

		afterAll(() => fs.rmSync(project, { recursive: true, force: true }));

		it("appends secret exclusions after the caller's own glob", () => {
			const { glob, pattern } = excludeSecretsFromGrep({
				pattern: 'KEY',
				glob: '*.{js,ts}'
			});
			expect(pattern).toBe('KEY');
			expect(glob.startsWith('*.{js,ts} !')).toBe(true);
			// Claude Code splits glob on spaces and commas
			expect(glob.split(' ').slice(1).join('')).not.toMatch(/[,{}]/);
		});

		it('hook rewrites a Grep over the project to skip secrets', async () => {
			const [hook] = createPathGuardHook(project).hooks;
			const result = await hook({
				tool_name: 'Grep',
				tool_input: { pattern: 'KEY', output_mode: 'content' }
			});
			expect(result.hookSpecificOutput.permissionDecision).toBeUndefined();
			expect(result.hookSpecificOutput.updatedInput).toEqual(
				excludeSecretsFromGrep({ pattern: 'KEY', output_mode: 'content' })
			);
		});

		it.skipIf(!ripgrep)(
			'Grep with no path returns secret lines without the rewrite',
			() => {
				const lines = runGrep(project, { pattern: 'API_KEY' });
				expect(lines).toContain('./.env:1:API_KEY=.env');
			}
		);

		it
			.skipIf(!ripgrep)
			.each([
				[{ pattern: 'API_KEY' }],
				[{ pattern: 'API_KEY', glob: '*' }],
				[{ pattern: 'API_KEY', glob: '**/*' }],
				[{ pattern: 'API_KEY', glob: '*.pub,*.local,*' }],
				[{ pattern: 'API_KEY', type: 'js' }]
			])('rewritten Grep %o returns no secret lines', (input) => {
			const lines = runGrep(project, excludeSecretsFromGrep(input));
			for (const secret of secrets) {
				expect(lines.join('\n')).not.toContain(`API_KEY=${secret}`);
			}
		});

		it.skipIf(!ripgrep)('rewritten Grep still searches other files', () => {
			const lines = runGrep(
				project,
				excludeSecretsFromGrep({ pattern: 'API_KEY' })
			);
			expect(lines).toEqual([
				'./README.md:1:API_KEY=README.md',
				'./src/app.js:1:API_KEY=src/app.js'
			]);
		});
	});

	it('ignores tools it does not guard', () => {
		expect(getPathViolation(root, 'WebFetch', { url: 'https://x' })).toBeNull();
	});

	it('hook denies outside access and returns nothing for inside access', async () => {
		const entry = createPathGuardHook(root);
		expect(entry.matcher).toBe('Read|Grep|Glob');
		const [hook] = entry.hooks;

		const denied = await hook({
			tool_name: 'Read',
			tool_input: { file_path: outside }
		});
		expect(denied.hookSpecificOutput.permissionDecision).toBe('deny');
		expect(denied.hookSpecificOutput.hookEventName).toBe('PreToolUse');

		expect(
			await hook({ tool_name: 'Read', tool_input: { file_path: 'src/a.js' } })
		).toEqual({});
	});
});
