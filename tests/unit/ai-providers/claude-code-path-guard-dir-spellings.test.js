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
import { getPathViolation } from '../../../src/ai-providers/claude-code-path-guard.js';

describe('claude-code path guard: secret directory spellings', () => {
	let project;

	beforeAll(() => {
		project = fs.realpathSync(
			fs.mkdtempSync(path.join(os.tmpdir(), 'tm-dirs-'))
		);
		fs.mkdirSync(path.join(project, '.docker'));
		fs.mkdirSync(path.join(project, '.config', 'git'), { recursive: true });
	});

	afterAll(() => fs.rmSync(project, { recursive: true, force: true }));

	// Windows drops the trailing dot or space, and a case-insensitive
	// filesystem matches the Kelvin sign to k and the dotless i to i
	it.each(['.docker.', '.docker ', '.docKer', '.config/gıt', '.config/git./'])(
		'denies a Grep of %j, which can open a secret directory',
		(searchPath) => {
			expect(
				getPathViolation(project, 'Grep', { pattern: 'KEY', path: searchPath })
			).toMatch(/secret/);
		}
	);

	it.each(['.docker', '.Docker', '.CONFIG/Git'])(
		'allows a Grep of %j, which the exclusions match in any ASCII case',
		(searchPath) => {
			expect(
				getPathViolation(project, 'Grep', { pattern: 'KEY', path: searchPath })
			).toBeNull();
		}
	);
});
