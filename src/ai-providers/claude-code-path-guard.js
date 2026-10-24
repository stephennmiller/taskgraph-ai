/**
 * src/ai-providers/claude-code-path-guard.js
 *
 * PreToolUse hook that keeps Claude Code's file tools (Read, Grep, Glob)
 * inside one directory and away from the secret files in it. It is passed to
 * the SDK as a programmatic hook, so it runs even when no settings sources are
 * loaded.
 */

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
		if (!isInsideRoot(root, p)) {
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
