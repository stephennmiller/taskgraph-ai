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

const GUARDED_TOOLS = ['Read', 'Grep', 'Glob'];

/** Resolve symlinks for the longest existing prefix of a path. */
function realpathOfExistingPrefix(target) {
	let current = target;
	const rest = [];
	for (;;) {
		try {
			return path.join(fs.realpathSync(current), ...rest.reverse());
		} catch {
			const parent = path.dirname(current);
			if (parent === current) return target;
			rest.push(path.basename(current));
			current = parent;
		}
	}
}

/**
 * @param {string} root - Absolute, real path of the allowed directory
 * @param {string} candidate - Path to test, relative paths resolve against root
 * @returns {boolean} True when candidate is root or inside it
 */
export function isInsideRoot(root, candidate) {
	if (typeof candidate !== 'string') return false;
	// Shell-style home expansion is not resolved by path.resolve; refuse it
	if (candidate.startsWith('~')) return false;
	const resolved = realpathOfExistingPrefix(path.resolve(root, candidate));
	const relative = path.relative(root, resolved);
	const leavesRoot = relative === '..' || relative.startsWith(`..${path.sep}`);
	return relative === '' || (!leavesRoot && !path.isAbsolute(relative));
}

// Names that hold credentials. .env.example and friends hold none. .aws is
// refused whole: besides credentials it holds SSO and CLI token caches.
const SECRET_NAME =
	/^(\.env([._-].*)?|\.envrc|\.git|\.aws|\.npmrc|[._]netrc|\.pypirc|id_(rsa|dsa|ecdsa|ed25519).*)$|\.(pem|key|p12|pfx|keystore)$/i;
const PUBLIC_ENV = /^\.env[._-](example|sample|template)$/i;
// Files that are secret only inside a given directory: [directory, file]
const SECRET_PAIRS = [['.docker', 'config.json']];
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

/** True when any part of a path or glob names a credentials file. */
function namesSecret(candidate) {
	const parts = candidate.split(/[\\/,]/).map(normalizeSegment);
	const secret = (part) =>
		SHORT_NAME.test(part) || (SECRET_NAME.test(part) && !PUBLIC_ENV.test(part));
	if (parts.some(secret)) return true;
	const lower = parts.map((part) => part.toLowerCase());
	return SECRET_PAIRS.some(([dir, file]) =>
		lower.some((part, i) => part === dir && lower[i + 1] === file)
	);
}

/** `env` -> `[eE][nN][vV]`, since rg globs are case-sensitive */
function anyCase(name) {
	return name.replace(
		/[a-z]/gi,
		(c) => `[${c.toLowerCase()}${c.toUpperCase()}]`
	);
}

// rg globs for the names SECRET_NAME matches; keep the two in step. They hold
// no commas or spaces, since Claude Code splits Grep's glob on both. They also
// skip .env.example: rg can't re-include a file without turning every other
// glob into an allow-list.
const SECRET_GLOBS = [
	'.env',
	'.env.*',
	'.env-*',
	'.env_*',
	'.envrc',
	'.git',
	'.aws',
	'.npmrc',
	'.netrc',
	'_netrc',
	'.pypirc',
	'id_rsa*',
	'id_dsa*',
	'id_ecdsa*',
	'id_ed25519*',
	'*.pem',
	'*.key',
	'*.p12',
	'*.pfx',
	'*.keystore',
	...SECRET_PAIRS.map(([dir, file]) => `**/${dir}/${file}`)
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
		if (targetsSecret(root, p)) {
			return `${toolName} may not open secret files such as .env, .git or keys (${p}).`;
		}
	}

	if (typeof toolInput.glob === 'string' && namesSecret(toolInput.glob)) {
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
				// No permissionDecision: the rewritten input still goes through
				// the session's own permission rules
				return {
					hookSpecificOutput: {
						hookEventName: 'PreToolUse',
						updatedInput: excludeSecretsFromGrep(input.tool_input)
					}
				};
			}
		]
	};
}
