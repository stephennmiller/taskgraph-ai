/**
 * Grep search paths that Windows or a case-insensitive filesystem opens as a
 * directory holding a path-scoped secret (.docker, .config/git). The rg
 * exclusions for `.docker/config.json` and `.config/git/credentials` match
 * the spelling rg is given, so these must be refused (#439).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
	createPathGuardHook,
	getPathViolation
} from '../../../src/ai-providers/claude-code-path-guard.js';
import { ripgrep, runGrep } from './claude-code-ripgrep.js';

/** True when this machine's temp filesystem ignores ASCII case */
function tmpIgnoresCase() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-case-'));
	try {
		return fs.existsSync(dir.toUpperCase());
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

describe('claude-code path guard: secret directory spellings', () => {
	let project;

	beforeAll(() => {
		project = fs.realpathSync(
			fs.mkdtempSync(path.join(os.tmpdir(), 'tm-dirs-'))
		);
		fs.mkdirSync(path.join(project, '.docker'));
		fs.mkdirSync(path.join(project, '.config', 'git'), { recursive: true });
		fs.writeFileSync(
			path.join(project, '.docker', 'config.json'),
			'API_KEY=.docker/config.json\n'
		);
		fs.writeFileSync(
			path.join(project, '.docker', 'other.json'),
			'API_KEY=.docker/other.json\n'
		);
		fs.writeFileSync(
			path.join(project, '.config', 'git', 'credentials'),
			'API_KEY=.config/git/credentials\n'
		);
	});

	afterAll(() => fs.rmSync(project, { recursive: true, force: true }));

	// Windows drops the trailing dot or space, and a case-insensitive
	// filesystem matches the Kelvin sign to k and the dotless i to i
	it.each([
		'.docker.',
		'.docker ',
		'.doc\u212Aer',
		'.config/gıt',
		'.config/git./'
	])('denies a Grep of %j, which can open a secret directory', (searchPath) => {
		expect(
			getPathViolation(project, 'Grep', { pattern: 'KEY', path: searchPath })
		).toMatch(/secret/);
	});

	it.each(['.docker', '.Docker', '.CONFIG/Git'])(
		'allows a Grep of %j, which the exclusions match in any ASCII case',
		(searchPath) => {
			expect(
				getPathViolation(project, 'Grep', { pattern: 'KEY', path: searchPath })
			).toBeNull();
		}
	);

	/**
	 * Run a Grep through the hook against the real filesystem: it is either
	 * refused, or the rewritten search returns no secret lines.
	 */
	async function grepLeaks(searchPath) {
		const [hook] = createPathGuardHook(project).hooks;
		const result = await hook({
			tool_name: 'Grep',
			tool_input: { pattern: 'API_KEY', path: searchPath }
		});
		const output = result.hookSpecificOutput;
		if (output.permissionDecision === 'deny') return { denied: true };
		const lines = runGrep(project, output.updatedInput).join('\n');
		return {
			denied: false,
			lines,
			leaked:
				lines.includes('API_KEY=.docker/config.json') ||
				lines.includes('API_KEY=.config/git/credentials')
		};
	}

	// These open the real directories only on Windows, so only there does a
	// missed spelling leak; elsewhere they name directories that don't exist
	describe.runIf(process.platform === 'win32' && ripgrep)(
		'on a real Windows filesystem',
		() => {
			it.each(['.docker.', '.docker ', '.config/git.', '.config/gıt'])(
				'a Grep of %j does not return secret lines',
				async (searchPath) => {
					const outcome = await grepLeaks(searchPath);
					expect(outcome.denied || !outcome.leaked).toBe(true);
				}
			);

			it('a Grep of .DOCKER still searches the rest of .docker', async () => {
				const outcome = await grepLeaks('.DOCKER');
				expect(outcome.leaked).toBe(false);
				expect(outcome.lines).toContain('API_KEY=.docker/other.json');
			});
		}
	);

	describe.runIf(process.platform === 'darwin' && ripgrep && tmpIgnoresCase())(
		'on a real case-insensitive macOS filesystem',
		() => {
			it.each(['.doc\u212Aer', '.DOCKER', '.CONFIG/GIT'])(
				'a Grep of %j does not return secret lines',
				async (searchPath) => {
					const outcome = await grepLeaks(searchPath);
					expect(outcome.denied || !outcome.leaked).toBe(true);
				}
			);

			it('a Grep of .DOCKER still searches the rest of .docker', async () => {
				const outcome = await grepLeaks('.DOCKER');
				expect(outcome.lines).toContain('API_KEY=.docker/other.json');
			});
		}
	);
});
