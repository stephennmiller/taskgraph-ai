/**
 * src/ai-providers/claude-code-path-guard.js
 *
 * PreToolUse hook that keeps Claude Code's file tools (Read, Grep, Glob)
 * inside one directory and away from the secret files in it. It is passed to
 * the SDK as a programmatic hook, so it runs even when no settings sources are
 * loaded.
 */

import fs from 'fs';
import path from 'path';
import { realpathOfExistingPrefix, resolvePathInsideRoot } from '@tm/core';

const GUARDED_TOOLS = ['Read', 'Grep', 'Glob'];

/**
 * @param {string} root - Absolute, real path of the allowed directory
 * @param {string} candidate - Path to test, relative paths resolve against root
 * @returns {boolean} True when candidate is root or inside it
 */
export function isInsideRoot(root, candidate) {
	return resolvePathInsideRoot(root, candidate) !== null;
}

// Names that hold credentials, in lower case. Both the name check and the rg
// globs that make a directory-wide Grep skip them are built from this table,
// so the two can't drift apart. .aws and .kube are refused whole: besides
// credentials and kubeconfigs (config, config-staging, ...) they hold SSO, CLI
// and OIDC token caches.
const SECRETS = {
	// Whole names
	names: [
		'.env',
		'.envrc',
		'.git',
		'.git-credentials',
		'.aws',
		'.kube',
		// Like every entry here, these match a directory of that name too: rg
		// globs can't match files only, so a Grep skips a `kubeconfig/` source
		// directory, and Read refuses it to agree (#438)
		'kubeconfig',
		'kubeconfig.yaml',
		'kubeconfig.yml',
		'.npmrc',
		'.netrc',
		'_netrc',
		'.pypirc',
		'.pgpass',
		// libpq's name for .pgpass on Windows
		'pgpass.conf'
	],
	// Names starting with one of these
	prefixes: [
		'.env.',
		'.env-',
		'.env_',
		'id_rsa',
		'id_dsa',
		'id_ecdsa',
		'id_ed25519',
		// kubeconfig-<cluster>, and Terraform EKS modules' kubeconfig_<name>.
		// Not a bare `kubeconfig`, which would refuse src/kubeconfig.ts
		'kubeconfig-',
		'kubeconfig_'
	],
	// Names ending in one of these: `kind-kubeconfig`, `<cluster>_kubeconfig`.
	// Not a bare `kubeconfig` suffix or a substring, so my-kubeconfig-loader.ts
	// and kubeconfigs.md stay readable
	suffixes: ['-kubeconfig', '_kubeconfig'],
	// Names ending in `.<extension>`
	extensions: [
		'pem',
		'key',
		'p12',
		'pfx',
		'keystore',
		'jks',
		'ppk',
		'kubeconfig'
	],
	// Files that are secret only inside given directories, as path segments.
	// .config/git/credentials is git's store helper's XDG file
	// ($XDG_CONFIG_HOME/git/credentials with XDG_CONFIG_HOME unset), which it
	// reads and, when .git-credentials doesn't exist, writes.
	paths: [
		['.docker', 'config.json'],
		['.config', 'git', 'credentials']
	]
};
// .env.example and friends hold none
const PUBLIC_ENV = /^\.env[._-](example|sample|template)$/i;
// A Windows 8.3 short name such as ENV~1 or ENVLOC~1.LOC. It can stand for
// any long name, .env included, so it is refused whatever it points at.
const SHORT_NAME = /^[^.~]{1,7}~\d+(\.[^.]{0,3})?$/;

/**
 * The name Windows opens for one path segment. It drops an alternate data
 * stream (`.env::$DATA`, `.env:x`) and trailing dots and spaces (`.env.`,
 * `.env `), all of which open the file the plain name does. Glob characters
 * are dropped too, so `.env*` is judged as `.env`. Applied on every platform:
 * on POSIX these are odd names, and refusing them costs nothing.
 * @param {string} segment - One path segment
 * @returns {string}
 */
export function normalizeSegment(segment) {
	return segment
		.replace(/[*?[\]{}]/g, '')
		.split(':')[0]
		.replace(/[. ]+$/, '');
}

/**
 * Fold case the way a case-insensitive filesystem compares names. NTFS
 * upper-cases both sides, so `.aw\u017F` (long s) and `.g\u0131t` (dotless i)
 * can open `.aws` and `.git`; APFS case-folds, so `server.\u212Aey` (Kelvin
 * sign) can open `server.key`. NFKC, then upper- then lower-casing maps all
 * three to ASCII, which a plain `/i` regex does not.
 */
function foldCase(name) {
	return name.normalize('NFKC').toUpperCase().toLowerCase();
}

/** True when any part of a path or glob names a credentials file. */
function namesSecret(candidate) {
	// Empty parts come from `//` and `/./` (normalizeSegment drops the dot), so
	// `.docker//config.json` is judged as `.docker/config.json`
	const parts = candidate
		.split(/[\\/,]/)
		.map((part) => foldCase(normalizeSegment(part)))
		.filter(Boolean);
	const secret = (part) =>
		SHORT_NAME.test(part) || (isSecretName(part) && !PUBLIC_ENV.test(part));
	if (parts.some(secret)) return true;
	return SECRETS.paths.some((segments) =>
		parts.some((_, i) =>
			segments.every((segment, j) => parts[i + j] === segment)
		)
	);
}

/** True when one case-folded path segment is a secret name */
function isSecretName(part) {
	return (
		SECRETS.names.includes(part) ||
		SECRETS.prefixes.some((prefix) => part.startsWith(prefix)) ||
		SECRETS.suffixes.some((suffix) => part.endsWith(suffix)) ||
		SECRETS.extensions.some((extension) => part.endsWith(`.${extension}`))
	);
}

/** `env` -> `[eE][nN][vV]`, since rg globs are case-sensitive */
function anyCase(name) {
	return name.replace(
		/[a-z]/gi,
		(c) => `[${c.toLowerCase()}${c.toUpperCase()}]`
	);
}

// rg globs for the names in SECRETS. They hold no commas or spaces, since
// Claude Code splits Grep's glob on both. They also skip .env.example: rg
// can't re-include a file without turning every other glob into an
// allow-list.
const SECRET_GLOBS = [
	...SECRETS.names,
	...SECRETS.prefixes.map((prefix) => `${prefix}*`),
	...SECRETS.suffixes.map((suffix) => `*${suffix}`),
	...SECRETS.extensions.map((extension) => `*.${extension}`),
	...SECRETS.paths.map((segments) => `**/${segments.join('/')}`)
].map((name) => `!${anyCase(name)}`);

/**
 * Grep input that skips secret files wherever its search walks.
 * The hook only sees the directory a Grep searches, so `{ pattern: 'KEY' }`
 * over the project would otherwise return lines from .env. Claude Code passes
 * each glob token to rg as `--glob`, and a later negated glob wins over the
 * caller's own globs and `type`.
 * @param {object} toolInput - Grep input
 * @returns {object} The input with exclusions appended to `glob`
 */
export function excludeSecretsFromGrep(toolInput = {}) {
	const own = typeof toolInput.glob === 'string' ? toolInput.glob.trim() : '';
	return {
		...toolInput,
		glob: [own, ...SECRET_GLOBS].filter(Boolean).join(' ')
	};
}

// Directories that hold a path-scoped secret: .docker, .config and git
const SECRET_DIRS = new Set(
	SECRETS.paths.flatMap((segments) => segments.slice(0, -1))
);

/**
 * True when the resolved path names a directory in SECRET_DIRS in a spelling
 * that only Windows or a case-insensitive filesystem opens as that directory:
 * `.docker.`, `.docker `, `.doc\u212Aer` (Kelvin sign), `.config/g\u0131t`
 * (dotless i). rg matches its exclusion for `.docker/config.json` against the
 * spelling it is given, so a Grep there would read the secret. Plain ASCII
 * case is fine, since those exclusions match any ASCII case. Only ASCII
 * letters are lower-cased for that comparison: toLowerCase maps the Kelvin
 * sign to k too.
 */
function spellsSecretDirOddly(root, candidate) {
	const resolved = resolvePathInsideRoot(root, candidate);
	if (resolved === null) return false;
	return path
		.relative(root, resolved)
		.split(/[\\/]/)
		.some((part) => {
			const opened = foldCase(normalizeSegment(part));
			const typed = part.replace(/[A-Z]/g, (c) => c.toLowerCase());
			return opened !== typed && SECRET_DIRS.has(opened);
		});
}

/** Judge the path below the root, and where a symlink really leads */
function targetsSecret(root, candidate) {
	const resolved = path.resolve(root, candidate);
	const real = realpathOfExistingPrefix(resolved);
	return [resolved, real].some((p) => namesSecret(path.relative(root, p)));
}

/**
 * True when a `..` in the path follows a symlink, so that the OS (which applies
 * `..` to the link's target) and path.resolve (which drops `link/..` as text)
 * reach different files. The Claude Code the Agent SDK ships (0.3.283)
 * normalizes file_path and path as text before opening them, so it opens what
 * the guard judged, but the guard shouldn't depend on that (#479).
 */
function climbsOutOfSymlink(root, candidate) {
	const parts = candidate.split(/[\\/]/);
	return parts.some((part, i) => {
		if (part !== '..') return false;
		const before = path.resolve(root, parts.slice(0, i).join('/'));
		return (
			path.dirname(realpathOfExistingPrefix(before)) !==
			realpathOfExistingPrefix(path.dirname(before))
		);
	});
}

function hasParentSegment(pattern) {
	return pattern.split(/[\\/]/).includes('..');
}

/**
 * The directory an absolute glob is searched from, or null for a relative
 * glob. Claude Code searches from the last separator before the first glob
 * character, so `/w/project*` is searched from `/w`, not `/w/project`.
 * Windows forms (`C:/x`, `C:\\x`, `\\\\server\\share`) count as absolute too.
 */
function absoluteGlobBase(pattern) {
	if (!path.posix.isAbsolute(pattern) && !path.win32.isAbsolute(pattern)) {
		return null;
	}
	const hasGlobChar = /[*?[{]/.test(pattern);
	if (!hasGlobChar) {
		// A plain path is split into dirname + basename, so `/w/project/` is
		// searched from `/w`
		const trimmed = pattern.replace(/[\\/]+$/, '') || pattern;
		return path.win32.isAbsolute(trimmed) && !path.posix.isAbsolute(trimmed)
			? path.win32.dirname(trimmed)
			: path.posix.dirname(trimmed);
	}
	const literal = pattern.split(/[*?[{]/)[0];
	const lastSeparator = Math.max(
		literal.lastIndexOf('/'),
		literal.lastIndexOf('\\')
	);
	return literal.slice(0, lastSeparator + 1) || literal;
}

/**
 * Decide whether a tool call stays inside the root.
 * @param {string} root - Allowed directory
 * @param {string} toolName
 * @param {object} toolInput
 * @returns {string|null} Reason to deny, or null when the call is allowed
 */
export function getPathViolation(root, toolName, toolInput = {}) {
	if (!GUARDED_TOOLS.includes(toolName)) return null;

	const paths = [toolInput.file_path, toolInput.path].filter(
		(p) => p !== undefined && p !== null
	);
	for (const p of paths) {
		if (!isInsideRoot(root, p) || climbsOutOfSymlink(root, p)) {
			return `${toolName} is limited to the project directory (${root}); ${p} is outside it.`;
		}
		if (targetsSecret(root, p) || spellsSecretDirOddly(root, p)) {
			return `${toolName} may not open secret files such as .env, .git or keys (${p}).`;
		}
	}

	// Claude Code passes each space-separated token of glob to rg on its own
	if (
		typeof toolInput.glob === 'string' &&
		toolInput.glob.split(/\s+/).some(namesSecret)
	) {
		return `${toolName} globs may not match secret files such as .env, .git or keys.`;
	}

	// Glob's pattern can name a directory of its own. Grep's pattern is a
	// regex and its glob only filters files under its path, so neither can
	// widen the search.
	const pattern = toolName === 'Glob' ? toolInput.pattern : undefined;
	if (typeof pattern === 'string') {
		const deny = `${toolName} patterns may not leave the project directory (${root}).`;
		if (hasParentSegment(pattern) || pattern.startsWith('~')) return deny;
		const base = absoluteGlobBase(pattern);
		if (base !== null && !isInsideRoot(root, base)) return deny;
		// Judge only the part below the root, whose own path may hold a short
		// name such as C:\Users\RUNNER~1
		const below = base === null ? pattern : path.relative(root, pattern);
		if (namesSecret(below)) {
			return `${toolName} patterns may not match secret files such as .env, .git or keys.`;
		}
	}
	return null;
}

/**
 * Build a PreToolUse hook entry that denies file access outside rootDir or to
 * secret files, and makes every Grep skip secret files.
 * @param {string} rootDir - Project root
 * @returns {{matcher: string, hooks: Function[]}}
 */
export function createPathGuardHook(rootDir) {
	const root = realpathOfExistingPrefix(path.resolve(rootDir));
	return {
		matcher: GUARDED_TOOLS.join('|'),
		hooks: [
			async (input) => {
				const reason = getPathViolation(
					root,
					input?.tool_name,
					input?.tool_input
				);
				if (reason) {
					return {
						hookSpecificOutput: {
							hookEventName: 'PreToolUse',
							permissionDecision: 'deny',
							permissionDecisionReason: reason
						}
					};
				}
				if (input?.tool_name !== 'Grep') return {};
				// rg matches the exclusion globs against the path as typed, so
				// `.docker//` or a symlink to .docker would skip
				// `**/.docker/config.json`; hand it the path judged above (#439)
				const toolInput = { ...input.tool_input };
				if (toolInput.path !== undefined && toolInput.path !== null) {
					toolInput.path = resolvePathInsideRoot(root, toolInput.path);
				}
				// No permissionDecision: the rewritten input still goes through
				// the session's own permission rules
				return {
					hookSpecificOutput: {
						hookEventName: 'PreToolUse',
						updatedInput: excludeSecretsFromGrep(toolInput)
					}
				};
			}
		]
	};
}

/** True when the path is a file that Read refuses */
function isSecretFile(root, file) {
	let stat;
	try {
		stat = fs.statSync(file, { throwIfNoEntry: false });
	} catch {
		// A throw would end the hook, and Claude Code would then hand the
		// model the Grep output unfiltered
		return false;
	}
	return (
		stat?.isFile() === true &&
		getPathViolation(root, 'Read', { file_path: file }) !== null
	);
}

/**
 * Grep output without the matches from files Read refuses. rg matches the
 * exclusion globs against names as they are on disk, so `.\uFF25NV` or
 * `\u212Aubeconfig` slips past `!.env` and `!kubeconfig` (#500); this judges
 * each result with the Read check instead.
 * @param {string} root - Absolute, real path of the allowed directory
 * @param {string} cwd - Directory Claude Code makes result paths relative to
 * @param {object} output - Grep's tool output
 * @returns {object|null} The filtered output, or null when nothing was dropped
 */
export function dropSecretMatches(root, cwd, output) {
	if (!output || typeof output !== 'object') return null;
	const filenames = Array.isArray(output.filenames) ? output.filenames : [];
	const lines =
		typeof output.content === 'string' ? output.content.split('\n') : [];
	// Each name is looked up in its directory's listing before it is judged,
	// so a line full of `:` and `-` costs no stat or path.resolve per
	// character: a hook that runs too long times out, and Claude Code then
	// passes the output on unfiltered
	const listings = new Map();
	const listing = (dir) => {
		if (!listings.has(dir)) {
			let names = null;
			try {
				names = new Set(fs.readdirSync(dir));
			} catch {}
			listings.set(dir, names);
		}
		return listings.get(dir);
	};
	const judged = new Map();
	const secret = (dir, name) => {
		if (listing(dir)?.has(name) !== true) return false;
		const file = path.join(dir, name);
		if (!judged.has(file)) judged.set(file, isSecretFile(root, file));
		return judged.get(file);
	};
	const secretFile = (file) => {
		const resolved = path.resolve(cwd, file);
		return secret(path.dirname(resolved), path.basename(resolved));
	};
	// A line starts with the file's path and then `:` or `-` (`a.js:3:x`,
	// `a.js-4-x`, `a.js:2` in count mode). Names can hold either character, so
	// every prefix that ends at one is tried.
	const fromSecretFile = (line) => {
		let dir = cwd;
		let start = 0;
		for (let i = 0; i < line.length; i++) {
			const c = line[i];
			if (c === '/' || c === path.sep) {
				// Real result paths are normalized, so every directory on them exists
				if (i > 0 && listing(dir) === null) return false;
				dir = path.resolve(cwd, line.slice(0, i + 1));
				start = i + 1;
			} else if (
				(c === ':' || c === '-') &&
				secret(dir, line.slice(start, i))
			) {
				return true;
			}
		}
		return false;
	};
	const keptFiles = filenames.filter((file) => !secretFile(file));
	const keptLines = lines.filter((line) => !fromSecretFile(line));
	if (
		keptFiles.length === filenames.length &&
		keptLines.length === lines.length
	) {
		return null;
	}
	const filtered = { ...output, filenames: keptFiles };
	if (output.mode === 'files_with_matches') {
		filtered.numFiles = keptFiles.length;
	}
	if (typeof output.content === 'string') {
		filtered.content = keptLines.join('\n');
		if (output.numLines !== undefined) filtered.numLines = keptLines.length;
	}
	if (output.mode === 'count') {
		const counts = keptLines.map((line) => Number(line.split(':').pop()));
		filtered.numFiles = counts.length;
		filtered.numMatches = counts.reduce((sum, n) => sum + (n || 0), 0);
	}
	return filtered;
}

/**
 * Build a PostToolUse hook entry that removes matches from secret files from
 * every Grep result.
 * @param {string} rootDir - Project root
 * @returns {{matcher: string, hooks: Function[]}}
 */
export function createGrepResultHook(rootDir) {
	const root = realpathOfExistingPrefix(path.resolve(rootDir));
	return {
		matcher: 'Grep',
		hooks: [
			async (input) => {
				const filtered = dropSecretMatches(
					root,
					input?.cwd ?? root,
					input?.tool_response
				);
				return filtered
					? {
							hookSpecificOutput: {
								hookEventName: 'PostToolUse',
								updatedToolOutput: filtered
							}
						}
					: {};
			}
		]
	};
}
