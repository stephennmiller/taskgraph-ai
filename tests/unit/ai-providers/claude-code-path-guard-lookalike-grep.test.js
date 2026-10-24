/**
 * Secret files whose names on disk are look-alike spellings (#500). rg
 * matches the exclusion globs against the bytes on disk, so a directory-wide
 * Grep still returns their lines; the PostToolUse hook drops every result
 * that Read would refuse.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
	createGrepResultHook,
	dropSecretMatches,
	excludeSecretsFromGrep,
	getPathViolation
} from '../../../src/ai-providers/claude-code-path-guard.js';
import { ripgrep, runGrep } from './claude-code-ripgrep.js';

describe('claude-code path guard: Grep results from look-alike secret names (#500)', () => {
	let project;

	// Every look-alike in the other guard tests, plus a fullwidth .env
	const secrets = [
		'.ＥNV',
		'.awſ/credentials',
		'.gıt/config',
		'ıd_rsa',
		'certs/server.Key',
		'.docker/config.jſon',
		'.docKer/config.json',
		'.Kube/config',
		'.pgpaſſ',
		'.gıt-credentials',
		'Kubeconfig',
		'.config/gıt/credentials',
		'Kubeconfig.yaml',
		'kind-Kubeconfig',
		'prod_Kubeconfıg'
	];
	const others = ['src/a.js', 'src/my-notes.js', 'docs/env.md'];

	beforeAll(() => {
		project = fs.realpathSync(
			fs.mkdtempSync(path.join(os.tmpdir(), 'tg-guard-lookalike-'))
		);
		for (const file of [...secrets, ...others]) {
			fs.mkdirSync(path.dirname(path.join(project, file)), { recursive: true });
			fs.writeFileSync(path.join(project, file), 'KEY=1\n');
		}
		// A line that names a secret file in its text stays
		fs.writeFileSync(path.join(project, 'docs/env.md'), 'KEY in ./.ＥNV: x\n');
	});

	afterAll(() => fs.rmSync(project, { recursive: true, force: true }));

	it.each(secrets)('Read refuses %j', (file) => {
		expect(getPathViolation(project, 'Read', { file_path: file })).toMatch(
			/secret/
		);
	});

	it.skipIf(!ripgrep)(
		'drops every look-alike match from a directory-wide Grep run by real rg',
		() => {
			const lines = runGrep(
				project,
				excludeSecretsFromGrep({ pattern: 'KEY' })
			);
			// rg's exclusion globs alone let them through
			expect(lines.length).toBeGreaterThan(others.length);

			const filtered = dropSecretMatches(project, project, {
				mode: 'content',
				numFiles: 0,
				filenames: [],
				content: lines.join('\n'),
				numLines: lines.length
			});

			// rg prints `.\src\a.js` on Windows
			expect(filtered.content.replaceAll('\\', '/').split('\n')).toEqual([
				'./docs/env.md:1:KEY in ./.ＥNV: x',
				'./src/a.js:1:KEY=1',
				'./src/my-notes.js:1:KEY=1'
			]);
			expect(filtered.numLines).toBe(3);
		}
	);

	it('drops secret files from files_with_matches and count output', () => {
		const files = dropSecretMatches(project, project, {
			mode: 'files_with_matches',
			filenames: [...secrets, ...others],
			numFiles: secrets.length + others.length
		});
		expect(files.filenames).toEqual(others);
		expect(files.numFiles).toBe(others.length);

		const counts = dropSecretMatches(project, project, {
			mode: 'count',
			numFiles: 2,
			filenames: [],
			content: [`${secrets[0]}:4`, 'src/a.js:2'].join('\n'),
			numMatches: 6
		});
		expect(counts).toMatchObject({
			content: 'src/a.js:2',
			numFiles: 1,
			numMatches: 2
		});
	});

	it('leaves output with no secret matches unchanged', () => {
		expect(
			dropSecretMatches(project, project, {
				mode: 'content',
				numFiles: 0,
				filenames: [],
				content: 'src/a.js:1:KEY=1'
			})
		).toBeNull();
	});

	it('rewrites the Grep output through the PostToolUse hook', async () => {
		const [hook] = createGrepResultHook(project).hooks;
		const out = await hook({
			tool_name: 'Grep',
			cwd: project,
			tool_response: {
				mode: 'files_with_matches',
				filenames: ['Kubeconfig', 'src/a.js'],
				numFiles: 2
			}
		});
		expect(out.hookSpecificOutput).toEqual({
			hookEventName: 'PostToolUse',
			updatedToolOutput: {
				mode: 'files_with_matches',
				filenames: ['src/a.js'],
				numFiles: 1
			}
		});
	});
});
