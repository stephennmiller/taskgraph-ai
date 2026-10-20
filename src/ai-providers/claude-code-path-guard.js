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
	return (
		relative === '' ||
		(!relative.startsWith('..') && !path.isAbsolute(relative))
	);
}

function hasParentSegment(pattern) {
	return pattern.split(/[\\/]/).includes('..');
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
	}

	// Glob patterns and Grep globs can reach outside the root on their own
	for (const pattern of [toolInput.pattern, toolInput.glob]) {
		if (typeof pattern !== 'string') continue;
		if (toolName === 'Grep' && pattern === toolInput.pattern) continue; // regex
		const base = pattern.startsWith('/') ? pattern : null;
		if (hasParentSegment(pattern) || pattern.startsWith('~')) {
			return `${toolName} patterns may not leave the project directory (${root}).`;
		}
		if (base && !isInsideRoot(root, base.split(/[*?[{]/)[0] || '/')) {
			return `${toolName} patterns may not leave the project directory (${root}).`;
		}
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
