/**
 * Guard: TaskGraph is local-first (issue #16). Tasks live in
 * .taskgraph/tasks/tasks.json, so @tm/core must not ship the cloud storage
 * (auth, briefs, API storage, Supabase) or any reference to Hamster.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(SRC_ROOT, '..');
const REPO_ROOT = join(PACKAGE_ROOT, '..', '..');
const THIS_FILE = basename(fileURLToPath(import.meta.url));

const CLOUD =
	/supabase|hamster|AuthManager|AuthDomain|ApiStorage|BriefsDomain|IntegrationDomain|getStorageType|StorageType|orgSlug|apiEndpoint|apiAccessToken|NO_BRIEF_SELECTED/i;

function sourceFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return sourceFiles(path);
		// Specs may assert that the cloud names are gone, so they are not scanned
		const isSource = /\.ts$/.test(name) && !/\.(spec|test)\./.test(name);
		return isSource && name !== THIS_FILE ? [path] : [];
	});
}

describe('Cloud storage removal', () => {
	it.each([
		'modules/auth',
		'modules/briefs',
		'modules/integration',
		'modules/storage/adapters/api-storage.ts',
		'modules/storage/utils/api-client.ts',
		'modules/tasks/repositories/supabase',
		'testing/auth-mocks.ts'
	])('no longer ships %s', (relative) => {
		expect(existsSync(join(SRC_ROOT, relative))).toBe(false);
	});

	it('does not depend on @supabase/supabase-js', () => {
		for (const manifest of [
			join(PACKAGE_ROOT, 'package.json'),
			join(REPO_ROOT, 'package.json')
		]) {
			expect(readFileSync(manifest, 'utf8')).not.toContain('supabase');
		}
	});

	it('does not reference the cloud storage from the core source', () => {
		const offenders = sourceFiles(SRC_ROOT).flatMap((file) =>
			readFileSync(file, 'utf8')
				.split('\n')
				.map((line, index) => ({ line, number: index + 1 }))
				.filter(({ line }) => CLOUD.test(line))
				.map(({ number }) => `${file.replace(SRC_ROOT, 'src')}:${number}`)
		);

		expect(offenders).toEqual([]);
	});
});
