/**
 * src/ai-providers/claude-code-path-guard.js
 *
 * PreToolUse hook that keeps Claude Code's file tools (Read, Grep, Glob)
 * inside one directory. It is passed to the SDK as a programmatic hook, so it
 * runs even when no settings sources are loaded.
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

// Names that hold credentials. .env.example and friends hold none.
const SECRET_NAME = /^(\.env(\..*)?|\.git|\.npmrc|id_.*)$|\.pem$/;
const PUBLIC_ENV = /^\.env\.(example|sample|template)$/;

/**
 * True when any part of a path or glob names a credentials file.
 * shortcut: a Grep over a whole directory still reads these files, because
 * the hook only sees the directory; upgrade if the guarded roles ever search
 * with secrets present.
 */
function namesSecret(candidate) {
	return candidate
		.split(/[\\/]/)
		.map((part) => part.replace(/[*?[\]{}]/g, ''))
		.some((part) => SECRET_NAME.test(part) && !PUBLIC_ENV.test(part));
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
		if (namesSecret(p)) {
			return `${toolName} may not open secret files such as .env, .git or keys (${p}).`;
		}
	}

	// Glob's pattern can name a directory of its own. Grep's pattern is a
	// regex and its glob only filters files under its path, so neither can
	// widen the search.
	const pattern = toolName === 'Glob' ? toolInput.pattern : undefined;
	if (typeof pattern === 'string') {
		const deny = `${toolName} patterns may not leave the project directory (${root}).`;
		if (hasParentSegment(pattern) || pattern.startsWith('~')) return deny;
		if (namesSecret(pattern)) {
			return `${toolName} patterns may not match secret files such as .env, .git or keys.`;
		}
		const base = absoluteGlobBase(pattern);
		if (base !== null && !isInsideRoot(root, base)) return deny;
	}
	return null;
}

/**
 * Build a PreToolUse hook entry that denies file access outside rootDir.
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
				return reason
					? {
							hookSpecificOutput: {
								hookEventName: 'PreToolUse',
								permissionDecision: 'deny',
								permissionDecisionReason: reason
							}
						}
					: {};
			}
		]
	};
}
