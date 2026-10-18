/**
 * The Hamster cloud integration is removed (issue #16): TaskGraph is local-first
 * and keeps shared state in GitHub. This guards the plain-JS side of the
 * codebase (scripts/ and src/) against Hamster, the bridge package that
 * redirected commands to it, and the auth/brief helpers that served it.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const SCAN_DIRS = ['scripts', 'src'];

const HAMSTER =
	/hamster|@tm\/bridge|AuthManager|AuthDomain|checkAndBlockIfAuthenticated|ensureOrgSelected|storageType/i;

function listJsFiles(dir) {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			return ['node_modules', 'dist'].includes(entry.name)
				? []
				: listJsFiles(full);
		}
		return entry.name.endsWith('.js') ? [full] : [];
	});
}

function findOffenders() {
	return SCAN_DIRS.flatMap((dir) => listJsFiles(path.join(ROOT, dir)))
		.flatMap((file) =>
			fs
				.readFileSync(file, 'utf8')
				.split('\n')
				.map((line, index) => ({ file, line, number: index + 1 }))
		)
		.filter(({ line }) => HAMSTER.test(line))
		.map(({ file, number }) => `${path.relative(ROOT, file)}:${number}`);
}

describe('Hamster integration', () => {
	it('is not referenced from scripts/ or src/', () => {
		expect(findOffenders()).toEqual([]);
	});

	it('no longer ships the @tm/bridge package', () => {
		// Only tracked content: a stale local node_modules/ or coverage/ is ignored
		expect(
			fs.existsSync(path.join(ROOT, 'packages/tm-bridge/package.json'))
		).toBe(false);
		expect(fs.existsSync(path.join(ROOT, 'packages/tm-bridge/src'))).toBe(
			false
		);
		expect(
			fs.readFileSync(path.join(ROOT, 'tsconfig.json'), 'utf8')
		).not.toContain('@tm/bridge');
	});
});
