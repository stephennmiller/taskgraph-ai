/**
 * The Hamster cloud integration is gone (issue #16). Outside the changelog,
 * archived notes, managed .taskgraph state and the specs that forbid the word,
 * nothing in the repository may mention it.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '../..');

const SKIPPED_DIRS = new Set([
	'node_modules',
	'dist',
	'coverage',
	'.turbo',
	'.git',
	// Archived chat transcripts
	'chats'
]);

const ALLOWED_FILES = new Set([
	'CHANGELOG.md',
	'package-lock.json',
	// Managed state and archived research notes
	'.taskgraph/state.json',
	'.taskgraph/docs/research/2025-11-18_should-we-be-doing-the-taskgraph-gateway-even-tho.md',
	// Specs that exist to forbid the word
	'tests/unit/hamster-free.test.js',
	'tests/unit/scripts/hamster-removal.test.js',
	'tests/unit/scripts/error-formatter.test.js',
	'apps/cli/src/hamster-usage.spec.ts',
	'apps/cli/src/command-registry.spec.ts',
	'apps/cli/src/ui/components/brand-banner.component.spec.ts',
	'packages/tm-core/src/cloud-removal.spec.ts'
]);

function listFiles(dir) {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			return SKIPPED_DIRS.has(entry.name) ? [] : listFiles(full);
		}
		return [full];
	});
}

function isText(file) {
	const buffer = fs.readFileSync(file);
	return !buffer.subarray(0, 8000).includes(0);
}

describe('Hamster', () => {
	test('is not mentioned outside the allowed files', () => {
		const offenders = listFiles(ROOT)
			.map((file) => path.relative(ROOT, file))
			.filter((relative) => !ALLOWED_FILES.has(relative))
			.filter((relative) => {
				const full = path.join(ROOT, relative);
				return isText(full) && /hamster/i.test(fs.readFileSync(full, 'utf8'));
			});

		expect(offenders).toEqual([]);
	});
});
