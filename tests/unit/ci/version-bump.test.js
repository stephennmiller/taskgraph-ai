import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	applyVersion,
	bumpVersion,
	determineBump,
	parseCommit
} from '../../../.github/scripts/version-bump.mjs';

describe('parseCommit', () => {
	it('reads type from the subject line', () => {
		expect(parseCommit('feat(cli): add find command (#12)')).toEqual({
			type: 'feat',
			breaking: false
		});
	});

	it('detects ! as breaking', () => {
		expect(parseCommit('feat!: upgrade to AI SDK 7').breaking).toBe(true);
		expect(parseCommit('fix(core)!: drop v1 ids').breaking).toBe(true);
	});

	it('detects a BREAKING CHANGE footer', () => {
		const msg = 'fix: tidy\n\nBREAKING CHANGE: removes --legacy flag';
		expect(parseCommit(msg).breaking).toBe(true);
	});

	it('ignores types and "!" that only appear in a squashed body bullet', () => {
		const msg = 'fix: squash (#3)\n\n* feat!: not the subject';
		expect(parseCommit(msg)).toEqual({ type: 'fix', breaking: false });
	});

	it('returns a null type for non-conventional subjects', () => {
		expect(parseCommit('Merge branch main').type).toBeNull();
	});

	describe('GitHub merge commits', () => {
		const merge = (branch, title = '') =>
			`Merge pull request #5 from stephennmiller/${branch}\n\n${title}`;

		it('uses the PR title from the merge body', () => {
			expect(parseCommit(merge('worktree-x', 'feat: add thing'))).toEqual({
				type: 'feat',
				breaking: false
			});
			expect(parseCommit(merge('x', 'fix(core)!: drop ids')).breaking).toBe(
				true
			);
		});

		it.each([
			['feature/TM-1-add-thing', 'feat'],
			['feat/add-thing', 'feat'],
			['fix/TM-2-crash', 'fix'],
			['bugfix/crash', 'fix'],
			['hotfix/crash', 'fix'],
			['worktree-fix-crash', 'fix'],
			['worktree-feature/add-thing', 'feat'],
			['perf/faster', 'perf']
		])('falls back to the branch prefix: %s -> %s', (branch, type) => {
			expect(parseCommit(merge(branch, 'Add a thing')).type).toBe(type);
		});

		it('prefers a conventional PR title over the branch prefix', () => {
			expect(parseCommit(merge('feature/x', 'fix: real type')).type).toBe(
				'fix'
			);
		});

		it('yields no type for unprefixed branches like worktree-ci-version-bump', () => {
			expect(
				parseCommit(merge('worktree-ci-version-bump', 'Add CI')).type
			).toBeNull();
		});

		it('does not apply the branch fallback to non-merge commits', () => {
			expect(parseCommit('Update stuff').type).toBeNull();
		});
	});
});

describe('determineBump', () => {
	it('returns null when nothing is releasable', () => {
		expect(
			determineBump(['chore: x', 'docs: y', 'ci: z', 'test: t'], '1.2.3')
		).toBeNull();
	});

	it('maps fix/perf/revert to patch', () => {
		expect(determineBump(['fix: a'], '1.2.3')).toBe('patch');
		expect(determineBump(['perf: a'], '1.2.3')).toBe('patch');
		expect(determineBump(['revert: a'], '1.2.3')).toBe('patch');
	});

	it('maps feat to minor and picks the highest bump', () => {
		expect(determineBump(['fix: a', 'feat: b'], '1.2.3')).toBe('minor');
	});

	it('maps breaking to major at >=1.0.0', () => {
		expect(determineBump(['feat!: a', 'feat: b'], '1.2.3')).toBe('major');
	});

	it('downshifts one level below 1.0.0', () => {
		expect(determineBump(['feat!: a'], '0.43.1')).toBe('minor');
		expect(determineBump(['feat: a'], '0.43.1')).toBe('patch');
		expect(determineBump(['fix: a'], '0.43.1')).toBe('patch');
	});

	it('ignores release commits created by the bot', () => {
		expect(
			determineBump(['chore(release): v1.0.1 [skip ci]'], '1.0.0')
		).toBeNull();
	});
});

describe('bumpVersion', () => {
	it.each([
		['1.2.3', 'patch', '1.2.4'],
		['1.2.3', 'minor', '1.3.0'],
		['1.2.3', 'major', '2.0.0'],
		['0.43.1', 'minor', '0.44.0']
	])('%s + %s = %s', (version, bump, expected) => {
		expect(bumpVersion(version, bump)).toBe(expected);
	});

	it('rejects invalid versions', () => {
		expect(() => bumpVersion('1.2', 'patch')).toThrow(/invalid version/i);
	});
});

describe('applyVersion', () => {
	let dir;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'version-bump-'));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it('updates all version files and preserves each file indentation', () => {
		writeFileSync(join(dir, 'package.json'), '{\n\t"version": "1.0.0"\n}\n');
		writeFileSync(
			join(dir, 'package-lock.json'),
			'{\n  "version": "1.0.0",\n  "packages": {\n    "": { "version": "1.0.0" }\n  }\n}\n'
		);

		applyVersion(dir, '1.1.0');

		expect(readFileSync(join(dir, 'package.json'), 'utf8')).toBe(
			'{\n\t"version": "1.1.0"\n}\n'
		);
		const lockText = readFileSync(join(dir, 'package-lock.json'), 'utf8');
		const lock = JSON.parse(lockText);
		expect(lock.version).toBe('1.1.0');
		expect(lock.packages[''].version).toBe('1.1.0');
		expect(lockText).toMatch(/^{\n {2}"version"/);
	});

	it('changes only the version values and leaves all other formatting untouched', () => {
		// Compact arrays are what biome's formatter expects; re-serializing with
		// JSON.stringify would expand them and fail the format check.
		const pkg = (version) =>
			`{\n\t"name": "x",\n\t"version": "${version}",\n\t"workspaces": ["apps/*", "packages/*", "."],\n\t"nested": { "version": "9.9.9" }\n}\n`;
		const lock = (version) =>
			`{\n  "name": "x",\n  "version": "${version}",\n  "lockfileVersion": 3,\n  "packages": {\n    "": {\n      "name": "x",\n      "version": "${version}",\n      "workspaces": ["apps/*", "."]\n    },\n    "node_modules/dep": {\n      "version": "5.0.0"\n    }\n  }\n}\n`;
		writeFileSync(join(dir, 'package.json'), pkg('1.0.0'));
		writeFileSync(join(dir, 'package-lock.json'), lock('1.0.0'));

		applyVersion(dir, '1.1.0');

		expect(readFileSync(join(dir, 'package.json'), 'utf8')).toBe(pkg('1.1.0'));
		expect(readFileSync(join(dir, 'package-lock.json'), 'utf8')).toBe(
			lock('1.1.0')
		);
	});

	it('throws when a file has no version to update', () => {
		writeFileSync(join(dir, 'package.json'), '{\n\t"name": "x"\n}\n');
		writeFileSync(
			join(dir, 'package-lock.json'),
			'{\n  "version": "1.0.0"\n}\n'
		);

		expect(() => applyVersion(dir, '1.1.0')).toThrow(/package\.json/);
	});
});
