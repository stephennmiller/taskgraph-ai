import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
	createPathGuardHook,
	excludeSecretsFromGrep,
	getPathViolation,
	isInsideRoot,
	normalizeSegment
} from '../../../src/ai-providers/claude-code-path-guard.js';
import { ripgrep, runGrep } from './claude-code-ripgrep.js';

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
			['.npmrc'],
			// #346
			['.envrc'],
			['.env-local'],
			['.env_prod'],
			['certs/server.key'],
			['certs/client.p12'],
			['certs/client.pfx'],
			['android/release.keystore'],
			['.netrc'],
			['_netrc'],
			['.pypirc'],
			['.aws/credentials'],
			['.aws/sso/cache/token.json'],
			// kubelogin keeps OIDC tokens here
			['.kube/cache/oidc-login/token'],
			['.kube/config-staging'],
			['.docker/config.json'],
			['home/.Docker/Config.json'],
			// #370, whose plain names are covered below
			['home/.GIT-CREDENTIALS'],
			['home/.KUBE/Config']
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

		it.each([
			['.git-credentials', '**/.git-credentials'],
			['android/release.jks', '**/*.jks'],
			['keys/server.ppk', '**/*.ppk'],
			['.pgpass', '**/.pgpass'],
			['.kube/config', '**/.kube/config'],
			// #396
			['kubeconfig', '**/kubeconfig'],
			['deploy/prod.kubeconfig', '**/*.kubeconfig'],
			['.config/git/credentials', '**/.config/git/credentials'],
			['AppData/Roaming/postgresql/pgpass.conf', '**/pgpass.conf'],
			// #438
			['kubeconfig.yaml', '**/kubeconfig.yaml'],
			['deploy/kubeconfig.yml', '**/kubeconfig.yml'],
			['kubeconfig-prod', '**/kubeconfig-*'],
			['terraform/kubeconfig_prod', '**/kubeconfig_*'],
			['deploy/Kubeconfig-Staging.yaml', 'Kubeconfig-*']
		])('denies Read, Glob and Grep of %s (#370, #396)', (file, pattern) => {
			expect(getPathViolation(root, 'Read', { file_path: file })).toMatch(
				/secret/
			);
			expect(getPathViolation(root, 'Glob', { pattern })).toMatch(/secret/);
			expect(
				getPathViolation(root, 'Grep', { pattern: 'x', path: file })
			).toMatch(/secret/);
			expect(
				getPathViolation(root, 'Grep', { pattern: 'x', glob: pattern })
			).toMatch(/secret/);
		});

		it('denies a Grep aimed at a secret file or directory', () => {
			expect(
				getPathViolation(root, 'Grep', { pattern: 'x', path: '.git' })
			).toMatch(/secret/);
			expect(
				getPathViolation(root, 'Grep', { pattern: 'x', path: '.kube' })
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

		it.each([
			['src/a.js'],
			['.env.example'],
			['.env-sample'],
			['docs/environment.md'],
			['src/keys.js'],
			['docker/config.json'],
			['.docker/daemon.json'],
			['config.json'],
			['notes~'],
			// #370 look-alikes
			['.gitignore'],
			['.git-blame-ignore-revs'],
			['git-credentials.md'],
			['docs/pgpass.md'],
			['src/jks.js'],
			['src/ppk-reader.ts'],
			['kube/config'],
			['.kubectl/config'],
			['deploy/config'],
			// #396 look-alikes
			['docs/kubeconfig.md'],
			['src/kubeconfig.ts'],
			['.config/git/config'],
			['.config/git/ignore'],
			['git/credentials'],
			['.config/credentials'],
			['docs/pgpass.conf.md'],
			// #438 look-alikes: no bare kubeconfig prefix
			['src/kubeconfig.yaml.ts'],
			['src/kubeconfigLoader.ts'],
			['docs/kubeconfigs.md']
		])('still allows %s', (file) => {
			expect(getPathViolation(root, 'Read', { file_path: file })).toBeNull();
		});
	});

	describe('Windows names that open a secret file (#346)', () => {
		it.each([
			['.env::$DATA', '.env'],
			['.env:hidden', '.env'],
			['.env:hidden:$DATA', '.env'],
			['.env.', '.env'],
			['.env ', '.env'],
			['.env. .', '.env'],
			['.npmrc  ', '.npmrc'],
			['.env*', '.env'],
			['C:', 'C'],
			['src', 'src'],
			['.env.example', '.env.example']
		])('normalizes %j to %j', (segment, name) => {
			expect(normalizeSegment(segment)).toBe(name);
		});

		it.each([
			['.env::$DATA'],
			['.env:hidden'],
			['.env '],
			['.env.'],
			['.ENV...'],
			['.git./config'],
			['.git /config'],
			['certs/server.key.'],
			['.aws ./credentials'],
			['.docker/config.json::$DATA'],
			// 8.3 short names: ENV~1 is how Windows may alias .env
			['ENV~1'],
			['env~2'],
			['ENVLOC~1.LOC'],
			['AWS~1/CREDEN~1']
		])('denies Read of %j', (file) => {
			expect(getPathViolation(root, 'Read', { file_path: file })).toMatch(
				/secret/
			);
		});

		it.each([['**/.env::$DATA'], ['ENV~1'], ['**/.env.']])(
			'denies Glob pattern and Grep glob %j',
			(pattern) => {
				expect(getPathViolation(root, 'Glob', { pattern })).toMatch(/secret/);
				expect(
					getPathViolation(root, 'Grep', { pattern: 'x', glob: pattern })
				).toMatch(/secret/);
			}
		);

		it.each([
			['.aw\u017F/credentials'],
			['.g\u0131t/config'],
			['\u0131d_rsa'],
			['certs/server.\u212Aey'],
			['.docker/config.j\u017Fon'],
			['.\u212Aube/config'],
			['.pgpa\u017F\u017F'],
			['.g\u0131t-credentials'],
			['\u212Aubeconfig'],
			['.config/g\u0131t/credentials']
		])('denies Read of case-fold look-alike %j', (file) => {
			expect(getPathViolation(root, 'Read', { file_path: file })).toMatch(
				/secret/
			);
		});

		it('denies a Grep glob that names a secret after a space', () => {
			expect(
				getPathViolation(root, 'Grep', { pattern: 'x', glob: '*.md .envrc' })
			).toMatch(/secret/);
			expect(
				getPathViolation(root, 'Grep', { pattern: 'x', glob: '*.md *.ts' })
			).toBeNull();
		});

		it('judges an absolute Glob only below the root, which may hold a short name', () => {
			const shortRoot = path.join(base, 'RUNNER~1', 'project');
			expect(
				getPathViolation(shortRoot, 'Glob', {
					pattern: `${shortRoot}/src/*.js`
				})
			).toBeNull();
			expect(
				getPathViolation(shortRoot, 'Glob', {
					pattern: `${shortRoot}/**/.env*`
				})
			).toMatch(/secret/);
		});
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
			'.git/config',
			// #346
			'.envrc',
			'.env-local',
			'.env_prod',
			'certs/server.key',
			'certs/client.p12',
			'certs/client.pfx',
			'android/release.keystore',
			'.netrc',
			'_netrc',
			'.pypirc',
			'.aws/credentials',
			'.aws/config',
			'.docker/config.json',
			'nested/.docker/config.json',
			// #370
			'.git-credentials',
			'.GIT-CREDENTIALS',
			'android/release.jks',
			'keys/server.ppk',
			'.pgpass',
			'.kube/config',
			'.kube/cache/oidc-login/token',
			'nested/.kube/config',
			// #396
			'kubeconfig',
			'deploy/prod.kubeconfig',
			'deploy/STAGING.KUBECONFIG',
			'.config/git/credentials',
			'nested/.config/git/credentials',
			'AppData/Roaming/postgresql/pgpass.conf',
			// #438
			'kubeconfig.yaml',
			'deploy/kubeconfig.yml',
			'KUBECONFIG.YAML',
			'kubeconfig-prod',
			'terraform/kubeconfig_prod',
			// A directory named kubeconfig is skipped whole, see below
			'pkg/kubeconfig/kubeconfig.go'
		];
		const others = [
			'src/app.js',
			'README.md',
			'.docker/daemon.json',
			'.config/git/config',
			// #438 look-alikes
			'src/kubeconfig.ts',
			'docs/kubeconfig.md'
		];

		beforeAll(() => {
			project = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-grep-'));
			for (const file of [...secrets, ...others]) {
				fs.mkdirSync(path.dirname(path.join(project, file)), {
					recursive: true
				});
				fs.writeFileSync(path.join(project, file), `API_KEY=${file}\n`);
			}
			// rg doesn't follow links while walking, so this stays unread too
			fs.symlinkSync('.env', path.join(project, 'notes.txt'));
		});

		afterAll(() => fs.rmSync(project, { recursive: true, force: true }));

		// Read and the Grep rewrite are built from one table (#396); this keeps
		// every file the rewrite must skip refused on Read too
		it.each(secrets)('also denies Read of %s', (file) => {
			expect(getPathViolation(project, 'Read', { file_path: file })).toMatch(
				/secret/
			);
		});

		it.each(others)('allows Read of %s', (file) => {
			expect(getPathViolation(project, 'Read', { file_path: file })).toBeNull();
		});

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

		// rg globs can't match files only, so `!kubeconfig` skips a directory of
		// that name too. Read refuses one as well, so the two agree (#438). To
		// let such directories through, change these tests together with
		// isSecretName and the SECRET_GLOBS built from it.
		describe('a directory named kubeconfig (#438)', () => {
			it.each([
				['Read', { file_path: 'pkg/kubeconfig/kubeconfig.go' }],
				['Read', { file_path: 'pkg/kubeconfig/' }],
				['Grep', { pattern: 'x', path: 'pkg/kubeconfig' }],
				['Grep', { pattern: 'x', glob: 'pkg/kubeconfig/*.go' }],
				['Glob', { pattern: 'pkg/kubeconfig/**' }]
			])('is refused on %s %o', (tool, input) => {
				expect(getPathViolation(project, tool, input)).toMatch(/secret/);
			});

			it.skipIf(!ripgrep)('is skipped by a rewritten Grep', () => {
				const input = { pattern: 'API_KEY', path: 'pkg' };
				const line = 'pkg/kubeconfig/kubeconfig.go:1:';
				expect(runGrep(project, input).join('\n')).toContain(line);
				expect(
					runGrep(project, excludeSecretsFromGrep(input)).join('\n')
				).not.toContain(line);
			});
		});

		describe('search path spellings (#439)', () => {
			// rg matches `**/.docker/config.json` against the path as typed, so
			// these walked into the directory-scoped secrets before the hook
			// handed rg the resolved path
			const spellings = [
				['.docker//', '.docker'],
				['.docker/./', '.docker'],
				['./.docker/', '.docker'],
				['src/../.docker', '.docker'],
				['docker-link', '.docker'],
				['.config//git', '.config/git'],
				['.config/./git/', '.config/git'],
				['nested/../.config/git/', '.config/git']
			];

			beforeAll(() => {
				fs.symlinkSync('.docker', path.join(project, 'docker-link'));
			});

			it.each(spellings)(
				'hook hands Grep of %s the resolved path',
				async (searchPath, resolved) => {
					const [hook] = createPathGuardHook(project).hooks;
					const result = await hook({
						tool_name: 'Grep',
						tool_input: { pattern: 'KEY', path: searchPath }
					});
					expect(result.hookSpecificOutput.updatedInput.path).toBe(
						path.join(fs.realpathSync(project), resolved)
					);
				}
			);

			it.skipIf(!ripgrep).each(spellings)(
				'rewritten Grep of %s returns no secret lines',
				async (searchPath, resolved) => {
					const [hook] = createPathGuardHook(project).hooks;
					const result = await hook({
						tool_name: 'Grep',
						tool_input: { pattern: 'API_KEY', path: searchPath }
					});
					const lines = runGrep(
						project,
						result.hookSpecificOutput.updatedInput
					).join('\n');
					expect(lines).not.toContain('API_KEY=.docker/config.json');
					expect(lines).not.toContain('API_KEY=.config/git/credentials');
					// Still searched: each directory holds one file that isn't secret
					expect(lines).toContain(`API_KEY=${resolved}/`);
				}
			);

			it.each([
				['Grep', { glob: '.docker//config.json' }],
				['Grep', { glob: '.config/./git/credentials' }],
				['Glob', { pattern: '.docker//config.json' }],
				['Glob', { pattern: '**/.config/./git//credentials' }]
			])('denies a %s glob that names a secret with %o', (tool, input) => {
				expect(getPathViolation(project, tool, input)).toMatch(/secret/);
			});
		});

		it.skipIf(!ripgrep)('rewritten Grep still searches other files', () => {
			const lines = runGrep(
				project,
				excludeSecretsFromGrep({ pattern: 'API_KEY' })
			);
			expect(lines).toEqual([
				'./.config/git/config:1:API_KEY=.config/git/config',
				'./.docker/daemon.json:1:API_KEY=.docker/daemon.json',
				'./README.md:1:API_KEY=README.md',
				'./docs/kubeconfig.md:1:API_KEY=docs/kubeconfig.md',
				'./src/app.js:1:API_KEY=src/app.js',
				'./src/kubeconfig.ts:1:API_KEY=src/kubeconfig.ts'
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
