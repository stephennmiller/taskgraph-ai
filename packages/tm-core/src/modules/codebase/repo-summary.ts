/**
 * @fileoverview A short summary of a project for AI prompts, so a Claude Code
 * call can plan from it instead of exploring the repo with Glob, Grep and
 * Read on every command. It looks like:
 *
 *   ## Project summary
 *
 *   Files, to depth 3:
 *   README.md
 *   package.json
 *   src/index.ts
 *   src/commands/ (12 files)
 *
 *   package.json: {"name":"demo","scripts":["build","test"],...}
 *
 *   README headings:
 *   # Demo
 *   ## Usage
 *
 *   Entry points: src/index.ts, bin/demo.js
 *
 * It is cached in .taskgraph/cache/ keyed by the git HEAD commit, so it is
 * built once per commit. Outside git it is built each time (it is cheap).
 * Only names and a few manifest fields are read; files that are symlinks are
 * skipped, so a link in the repo can't pull outside text into the prompt.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
	TASKGRAPH_CACHE_DIR,
	TASKGRAPH_DIR
} from '../../common/constants/paths.js';

/** Bump when the summary's content changes, so old caches are rebuilt */
const SUMMARY_VERSION = 1;
const CACHE_FILE = 'repo-summary.json';
const TREE_DEPTH = 3;
const MAX_TREE_LINES = 150;
const MAX_WALK_FILES = 20000;
const MAX_FILE_BYTES = 64 * 1024;
const MAX_MANIFEST_LINES = 30;
const MAX_HEADINGS = 30;
const MAX_ENTRY_POINTS = 10;
const MAX_SUMMARY_CHARS = 8000;

/** Directories that are build output, dependencies or tool state */
const SKIPPED_DIRS = new Set([
	'.git',
	TASKGRAPH_DIR,
	'node_modules',
	'bower_components',
	'vendor',
	'dist',
	'build',
	'out',
	'coverage',
	'target',
	'.next',
	'.nuxt',
	'.turbo',
	'.cache',
	'__pycache__',
	'.venv',
	'venv',
	'.tox',
	'.gradle',
	'.idea',
	'.vscode'
]);

/** Shown raw (first lines); package.json is shown as picked fields */
const MANIFESTS = [
	'pyproject.toml',
	'requirements.txt',
	'Cargo.toml',
	'go.mod',
	'Gemfile',
	'composer.json',
	'pom.xml',
	'build.gradle',
	'build.gradle.kts',
	'Package.swift',
	'mix.exs',
	'deno.json'
];

const README_NAMES = ['README.md', 'readme.md', 'Readme.md', 'README.markdown'];

const ENTRY_POINT_PATTERNS = [
	/^(src\/)?(index|main|app|server|cli)\.(ts|tsx|js|jsx|mjs|cjs)$/,
	/^(src\/)?(main|app|__main__|manage)\.py$/,
	/^src\/(main|lib)\.rs$/,
	/^main\.go$/,
	/^cmd\/[^/]+\/main\.go$/,
	/^bin\/[^/]+$/
];

interface CachedSummary {
	version: number;
	head: string;
	summary: string;
}

/** The HEAD commit of the repo `root` is in, or null outside git */
function gitHead(root: string): string | null {
	try {
		const head = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], {
			cwd: root,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
			timeout: 5000
		}).trim();
		return /^[0-9a-f]{40,64}$/.test(head) ? head : null;
	} catch {
		return null;
	}
}

/** Text of a regular file under `root`, or null (missing, symlink, too big) */
function readProjectFile(root: string, relative: string): string | null {
	const file = path.join(root, relative);
	try {
		const info = fs.lstatSync(file);
		if (!info.isFile() || info.size > MAX_FILE_BYTES) return null;
		return fs.readFileSync(file, 'utf8');
	} catch {
		return null;
	}
}

const isSkipped = (relative: string) =>
	relative.split('/').some((part) => SKIPPED_DIRS.has(part));

/** Files tracked by git under `root`, relative to it with `/` separators */
function gitFiles(root: string): string[] | null {
	try {
		const out = execFileSync('git', ['ls-files', '-z'], {
			cwd: root,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
			timeout: 10000,
			maxBuffer: 64 * 1024 * 1024
		});
		return out.split('\0').filter(Boolean);
	} catch {
		return null;
	}
}

/** Files under `root` without git: skips SKIPPED_DIRS, doesn't follow links */
function walkFiles(root: string): string[] {
	const files: string[] = [];
	const visit = (dir: string, prefix: string) => {
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (files.length >= MAX_WALK_FILES) return;
			const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
			if (entry.isDirectory()) {
				if (!SKIPPED_DIRS.has(entry.name)) {
					visit(path.join(dir, entry.name), relative);
				}
			} else {
				files.push(relative);
			}
		}
	};
	visit(root, '');
	return files;
}

/**
 * Paths to `depth` levels. Deeper files are folded into their ancestor at
 * that depth, shown as `dir/ (N files)`.
 */
function treeLines(files: string[], depth: number): string[] {
	const shown = new Map<string, number>();
	for (const file of files) {
		const parts = file.split('/');
		const key =
			parts.length <= depth ? file : `${parts.slice(0, depth).join('/')}/`;
		shown.set(key, (shown.get(key) ?? 0) + 1);
	}
	return [...shown.keys()]
		.sort()
		.map((key) =>
			key.endsWith('/')
				? `${key} (${shown.get(key)} ${shown.get(key) === 1 ? 'file' : 'files'})`
				: key
		);
}

/** The tree at the deepest level (3 at most) that fits MAX_TREE_LINES */
function fileTree(files: string[]): { depth: number; lines: string[] } {
	let lines: string[] = [];
	for (let depth = TREE_DEPTH; depth >= 1; depth--) {
		lines = treeLines(files, depth);
		if (lines.length <= MAX_TREE_LINES) return { depth, lines };
	}
	return {
		depth: 1,
		lines: [
			...lines.slice(0, MAX_TREE_LINES),
			`… and ${lines.length - MAX_TREE_LINES} more`
		]
	};
}

const keysOf = (value: unknown) =>
	value && typeof value === 'object' && !Array.isArray(value)
		? Object.keys(value)
		: undefined;

/** The package.json fields that say what a project is and how it runs */
function describePackageJson(text: string): {
	line: string;
	entryPoints: string[];
} | null {
	let pkg: Record<string, unknown>;
	try {
		pkg = JSON.parse(text);
	} catch {
		return null;
	}
	if (!pkg || typeof pkg !== 'object') return null;
	const picked: Record<string, unknown> = {};
	for (const field of [
		'name',
		'description',
		'type',
		'main',
		'module',
		'bin',
		'workspaces',
		'engines'
	]) {
		if (pkg[field] !== undefined) picked[field] = pkg[field];
	}
	if (typeof pkg.exports === 'string') picked.exports = pkg.exports;
	for (const field of [
		'scripts',
		'dependencies',
		'devDependencies',
		'peerDependencies'
	]) {
		const keys = keysOf(pkg[field]);
		if (keys?.length) picked[field] = keys;
	}

	const entryPoints: string[] = [];
	for (const field of ['main', 'module', 'exports']) {
		if (typeof pkg[field] === 'string') entryPoints.push(pkg[field] as string);
	}
	if (typeof pkg.bin === 'string') entryPoints.push(pkg.bin);
	for (const value of Object.values(
		(keysOf(pkg.bin) ? pkg.bin : {}) as object
	)) {
		if (typeof value === 'string') entryPoints.push(value);
	}
	return {
		line: `package.json: ${JSON.stringify(picked)}`,
		entryPoints: entryPoints.map((p) => p.replace(/^\.\//, ''))
	};
}

function readmeHeadings(root: string): string[] {
	for (const name of README_NAMES) {
		const text = readProjectFile(root, name);
		if (text === null) continue;
		const headings: string[] = [];
		let inFence = false;
		for (const line of text.split(/\r?\n/)) {
			if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
			else if (!inFence && /^#{1,3}\s+\S/.test(line)) {
				headings.push(line.trim().slice(0, 120));
			}
			if (headings.length >= MAX_HEADINGS) break;
		}
		return headings;
	}
	return [];
}

/**
 * Build the summary of the project at `root`: file tree to depth 3,
 * manifests, README headings and entry points. Doesn't use the cache.
 */
export function buildRepoSummary(root: string): string {
	const tracked = gitFiles(root);
	const files = (tracked ?? walkFiles(root)).filter((f) => !isSkipped(f));
	const sections: string[] = ['## Project summary'];

	const tree = fileTree(files);
	sections.push(
		files.length
			? `Files${tracked ? ' tracked by git' : ''}, to depth ${tree.depth}:\n${tree.lines.join('\n')}`
			: 'No files yet.'
	);

	const manifestLines: string[] = [];
	const entryPoints: string[] = [];
	const pkgText = readProjectFile(root, 'package.json');
	const pkg = pkgText === null ? null : describePackageJson(pkgText);
	if (pkg) {
		manifestLines.push(pkg.line);
		entryPoints.push(...pkg.entryPoints);
	}
	for (const name of MANIFESTS) {
		const text = readProjectFile(root, name);
		if (text === null) continue;
		const lines = text.split(/\r?\n/);
		const head = lines.slice(0, MAX_MANIFEST_LINES).join('\n').trimEnd();
		const more =
			lines.length > MAX_MANIFEST_LINES
				? `\n… ${lines.length - MAX_MANIFEST_LINES} more lines`
				: '';
		manifestLines.push(`${name}:\n${head}${more}`);
	}
	if (manifestLines.length) sections.push(manifestLines.join('\n\n'));

	const headings = readmeHeadings(root);
	if (headings.length) {
		sections.push(`README headings:\n${headings.join('\n')}`);
	}

	for (const file of files) {
		if (ENTRY_POINT_PATTERNS.some((pattern) => pattern.test(file))) {
			entryPoints.push(file);
		}
	}
	const uniqueEntryPoints = [...new Set(entryPoints)].slice(
		0,
		MAX_ENTRY_POINTS
	);
	if (uniqueEntryPoints.length) {
		sections.push(`Entry points: ${uniqueEntryPoints.join(', ')}`);
	}

	const summary = sections.join('\n\n');
	return summary.length > MAX_SUMMARY_CHARS
		? `${summary.slice(0, MAX_SUMMARY_CHARS - 2).trimEnd()}\n…`
		: summary;
}

function readCache(file: string): CachedSummary | null {
	try {
		const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
		return cached && typeof cached.summary === 'string' ? cached : null;
	} catch {
		return null;
	}
}

/** Save the cache; a failure only costs a rebuild next time */
function writeCache(root: string, cached: CachedSummary): void {
	const dir = path.join(root, TASKGRAPH_CACHE_DIR);
	try {
		fs.mkdirSync(dir, { recursive: true });
		// Keep the cache out of git without editing the project's .gitignore
		const ignore = path.join(dir, '.gitignore');
		if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, '*\n');
		const file = path.join(dir, CACHE_FILE);
		const temp = `${file}.${process.pid}.tmp`;
		fs.writeFileSync(temp, JSON.stringify(cached, null, 2));
		fs.renameSync(temp, file);
	} catch {
		// Read-only checkout or similar; the summary still works uncached
	}
}

/**
 * The project summary for AI prompts, from .taskgraph/cache/ when it was
 * built at the current git HEAD, otherwise built now (and cached when the
 * project is in git and has a .taskgraph folder).
 *
 * @param root - Project root
 */
export function getRepoSummary(root: string): string {
	const head = gitHead(root);
	const cacheFile = path.join(root, TASKGRAPH_CACHE_DIR, CACHE_FILE);
	if (head) {
		const cached = readCache(cacheFile);
		if (cached?.head === head && cached.version === SUMMARY_VERSION) {
			return cached.summary;
		}
	}
	const summary = buildRepoSummary(root);
	if (head && fs.existsSync(path.join(root, TASKGRAPH_DIR))) {
		writeCache(root, { version: SUMMARY_VERSION, head, summary });
	}
	return summary;
}
