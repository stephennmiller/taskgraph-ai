#!/usr/bin/env node
// Conventional-commit version bump, run by .github/workflows/version-bump.yml
// on every push to main. Computes the next version from commits since the tag
// of the current version, rewrites the version files, and reports the result
// via GITHUB_OUTPUT. It never commits, tags or pushes; the workflow does that.
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findRootDir } from './utils.mjs';

const BUMP_RANK = { patch: 1, minor: 2, major: 3 };
const TYPE_TO_BUMP = {
	feat: 'minor',
	fix: 'patch',
	perf: 'patch',
	revert: 'patch'
};
const MERGE_RE = /^Merge pull request #\d+ from (\S+)/;
const BRANCH_PREFIX_TO_TYPE = {
	feat: 'feat',
	feature: 'feat',
	fix: 'fix',
	bugfix: 'fix',
	hotfix: 'fix',
	perf: 'perf'
};
const SUBJECT_RE = /^(\w+)(?:\([^)]*\))?(!)?:\s/;
const BREAKING_FOOTER_RE = /^BREAKING[ -]CHANGE:/m;

// Only the subject line counts for type and "!": squash-merge bodies list the
// PR's individual commits as bullets, which must not influence the bump.
export function parseCommit(message) {
	const [firstLine, ...rest] = message.split('\n');
	const merge = MERGE_RE.exec(firstLine);
	// A GitHub merge commit's subject is generated; the PR title is the first
	// body line. Its branch name is only a fallback for non-conventional titles.
	const subject = merge ? (rest.find((l) => l.trim()) ?? '') : firstLine;
	const match = SUBJECT_RE.exec(subject);
	return {
		type: match ? match[1] : merge ? typeFromBranch(merge[1]) : null,
		breaking: Boolean(match?.[2]) || BREAKING_FOOTER_RE.test(message)
	};
}

// `owner/feature/x`, `worktree-fix-x` and `fix/x` all resolve by prefix;
// anything else (e.g. `worktree-ci-version-bump`) is treated as not releasable.
function typeFromBranch(ref) {
	const branch = ref
		.split('/')
		.slice(1)
		.join('/')
		.replace(/^worktree-/, '');
	const prefix = /^([a-z]+)[/-]/.exec(branch)?.[1];
	return BRANCH_PREFIX_TO_TYPE[prefix] ?? null;
}

export function bumpVersion(version, bump) {
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
	if (!match) throw new Error(`Invalid version: ${version}`);
	const [major, minor, patch] = match.slice(1).map(Number);
	if (bump === 'major') return `${major + 1}.0.0`;
	if (bump === 'minor') return `${major}.${minor + 1}.0`;
	return `${major}.${minor}.${patch + 1}`;
}

// Returns 'major' | 'minor' | 'patch', or null when nothing is releasable.
// Below 1.0.0 every level shifts down one (breaking -> minor, feat -> patch)
// so a `feat!:` doesn't unexpectedly graduate the package to 1.0.0.
export function determineBump(messages, currentVersion) {
	let highest = null;
	for (const message of messages) {
		const { type, breaking } = parseCommit(message);
		const bump = breaking ? 'major' : TYPE_TO_BUMP[type];
		if (bump && (!highest || BUMP_RANK[bump] > BUMP_RANK[highest])) {
			highest = bump;
		}
	}
	if (highest && currentVersion.startsWith('0.')) {
		return highest === 'major' ? 'minor' : 'patch';
	}
	return highest;
}

function readJson(path) {
	const text = readFileSync(path, 'utf8');
	const indent = /^[ \t]+/m.exec(text)?.[0] ?? '\t';
	return { data: JSON.parse(text), indent };
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Edits only the version values in the file's text. Re-serializing with
// JSON.stringify would expand short arrays (e.g. "workspaces"), which fails
// the repo's biome format check, so everything else is left byte-for-byte.
function setVersionInText(text, version, file) {
	const indent = /^[ \t]+/m.exec(text)?.[0] ?? '\t';
	const topLevel = new RegExp(
		`^(${escapeRegExp(indent)}"version"\\s*:\\s*")[^"]*(")`,
		'm'
	);
	if (!topLevel.test(text)) {
		throw new Error(`${file}: no top-level "version" found to update`);
	}
	let updated = text.replace(topLevel, (_, a, b) => `${a}${version}${b}`);

	const hasRootPackage = Boolean(JSON.parse(text).packages?.['']);
	if (hasRootPackage) {
		const rootEntry =
			/("packages"\s*:\s*\{\s*""\s*:\s*\{[^{}]*?"version"\s*:\s*")[^"]*(")/;
		if (!rootEntry.test(updated)) {
			throw new Error(`${file}: no packages[""] "version" found to update`);
		}
		updated = updated.replace(rootEntry, (_, a, b) => `${a}${version}${b}`);
	}

	const parsed = JSON.parse(updated);
	const rootVersion = parsed.packages?.['']?.version;
	if (
		parsed.version !== version ||
		(hasRootPackage && rootVersion !== version)
	) {
		throw new Error(`${file}: version update did not apply cleanly`);
	}
	return updated;
}

export function applyVersion(rootDir, version) {
	for (const file of ['package.json', 'manifest.json', 'package-lock.json']) {
		const path = join(rootDir, file);
		writeFileSync(
			path,
			setVersionInText(readFileSync(path, 'utf8'), version, file),
			'utf8'
		);
	}
}

function git(rootDir, args) {
	const result = spawnSync('git', args, { cwd: rootDir, encoding: 'utf8' });
	if (result.status !== 0) {
		throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
	}
	return result.stdout;
}

// The released baseline is the tag for the version currently in package.json,
// in either the new `v1.2.3` form or the legacy changesets `name@1.2.3` form.
function findBaselineTag(rootDir, name, version) {
	const tags = git(rootDir, ['tag', '--list']).split('\n');
	const tag = [`v${version}`, `${name}@${version}`].find((t) =>
		tags.includes(t)
	);
	if (!tag) {
		throw new Error(
			`No tag found for current version ${version} (looked for v${version} and ${name}@${version}). Tag the last release before enabling the workflow.`
		);
	}
	return tag;
}

function commitsSince(rootDir, tag) {
	return git(rootDir, ['log', `${tag}..HEAD`, '--format=%B%x00'])
		.split('\0')
		.map((m) => m.trim())
		.filter(Boolean);
}

function setOutputs(outputs) {
	const lines = Object.entries(outputs).map(([k, v]) => `${k}=${v}`);
	console.log(lines.join('\n'));
	if (process.env.GITHUB_OUTPUT) {
		appendFileSync(process.env.GITHUB_OUTPUT, lines.join('\n') + '\n');
	}
}

function main() {
	const dryRun = process.argv.includes('--dry-run');
	const rootDir = findRootDir(dirname(fileURLToPath(import.meta.url)));
	const { data: pkg } = readJson(join(rootDir, 'package.json'));

	const baseline = findBaselineTag(rootDir, pkg.name, pkg.version);
	const bump = determineBump(commitsSince(rootDir, baseline), pkg.version);

	if (!bump) {
		console.log(`No releasable commits since ${baseline}; skipping release.`);
		setOutputs({ bumped: 'false' });
		return;
	}

	const version = bumpVersion(pkg.version, bump);
	console.log(`${baseline} -> v${version} (${bump})`);
	if (!dryRun) applyVersion(rootDir, version);
	setOutputs({
		bumped: 'true',
		version,
		tag: `v${version}`,
		bump,
		baseline
	});
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	try {
		main();
	} catch (error) {
		console.error(`❌ ${error.message}`);
		process.exit(1);
	}
}
