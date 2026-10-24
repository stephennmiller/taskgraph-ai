/**
 * @fileoverview The file and project-tree context `research` sends the model,
 * in the legacy ContextGatherer's 'research' format
 * (`scripts/modules/utils/contextGatherer.js`). Files are read only when they
 * stay inside the project and aren't secrets: their content goes to the model.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
	ERROR_CODES,
	TaskGraphError
} from '../../common/errors/taskgraph-error.js';
import { realpathOfExistingPrefix } from '../../common/utils/path-inside-root.js';
import {
	getPathViolation,
	isInsideRoot
} from './providers/claude-code-path-guard.js';

/** About 4 characters per token: an estimate for logs and replies */
export const estimateTokens = (text: string): number =>
	text ? Math.ceil(text.length / 4) : 0;

/** Files bigger than this are left out of the context */
const MAX_FILE_BYTES = 50 * 1024;
/** How many directory levels the project tree shows */
const TREE_DEPTH = 5;
const TREE_IGNORED = new Set([
	'.git',
	'node_modules',
	'.env',
	'coverage',
	'dist',
	'build',
	'.DS_Store',
	'.env.local',
	'.env.production'
]);

export interface FileContextEntry {
	/** Relative to the project root */
	path: string;
	sizeKB: number;
	tokens: number;
	characters: number;
}

export interface ProjectTreeEntry {
	tokens: number;
	characters: number;
	fileCount: number;
	dirCount: number;
}

/**
 * Resolve a file given as context, relative to the project root or absolute.
 * Throws INVALID_INPUT when it is outside the project or a secret file the
 * Claude Code path guard refuses (.env, .git, keys, a link out of the
 * project), and NOT_FOUND when it doesn't exist.
 * @returns The absolute path
 */
export function resolveContextFile(projectRoot: string, file: string): string {
	const root = realpathOfExistingPrefix(path.resolve(projectRoot));
	if (!isInsideRoot(root, file)) {
		throw new TaskGraphError(
			`${file} is outside the project (${projectRoot})`,
			ERROR_CODES.INVALID_INPUT
		);
	}
	if (getPathViolation(root, 'Read', { file_path: file })) {
		throw new TaskGraphError(
			`${file} is a secret file (such as .env, .git or a key) or links out of the project; it isn't sent to the model`,
			ERROR_CODES.INVALID_INPUT
		);
	}
	const full = path.resolve(root, file);
	if (!fs.existsSync(full)) {
		throw new TaskGraphError(
			`File not found: ${file}`,
			ERROR_CODES.FILE_NOT_FOUND
		);
	}
	return full;
}

/**
 * The "## File Context" section for files resolveContextFile accepted. A
 * directory or a file over 50 KB is left out with a warning.
 */
export function gatherFileContext(
	projectRoot: string,
	files: string[],
	warn: (message: string) => void
): { context: string; breakdown: FileContextEntry[] } {
	const items: string[] = [];
	const breakdown: FileContextEntry[] = [];
	const root = realpathOfExistingPrefix(path.resolve(projectRoot));
	for (const file of files) {
		const relative = path.relative(root, file);
		try {
			const stats = fs.statSync(file);
			if (!stats.isFile()) {
				warn(`${relative} isn't a file; left it out of the context`);
				continue;
			}
			if (stats.size > MAX_FILE_BYTES) {
				warn(
					`${relative} is over ${MAX_FILE_BYTES / 1024} KB; left it out of the context`
				);
				continue;
			}
			const content = fs.readFileSync(file, 'utf-8');
			const item = `**File: ${relative}** (${Math.round(stats.size / 1024)}KB)\n\n\`\`\`\n${content}\n\`\`\``;
			items.push(item);
			breakdown.push({
				path: relative,
				sizeKB: Math.round(stats.size / 1024),
				tokens: estimateTokens(item),
				characters: item.length
			});
		} catch (error) {
			warn(`Could not read ${relative}: ${(error as Error).message}`);
		}
	}
	return {
		context: items.length
			? `## File Context\n\n${items.join('\n\n---\n\n')}`
			: '',
		breakdown
	};
}

interface TreeNode {
	name: string;
	children: Array<TreeNode | string>;
	fileCount: number;
	dirCount: number;
}

function buildTree(
	dir: string,
	depth: number,
	root = realpathOfExistingPrefix(dir)
): TreeNode | null {
	if (depth >= TREE_DEPTH) return null;
	let names: string[];
	try {
		names = fs.readdirSync(dir);
	} catch {
		return null;
	}
	const node: TreeNode = {
		name: path.basename(dir),
		children: [],
		fileCount: 0,
		dirCount: 0
	};
	for (const name of names) {
		if (TREE_IGNORED.has(name)) continue;
		const full = path.join(dir, name);
		let isDirectory: boolean;
		try {
			isDirectory = fs.statSync(full).isDirectory();
		} catch {
			continue;
		}
		if (isDirectory) {
			node.dirCount++;
			// A link to a directory outside the project is counted, not listed
			if (!isInsideRoot(root, full)) continue;
			const child = buildTree(full, depth + 1, root);
			if (child) node.children.push(child);
		} else {
			node.fileCount++;
			node.children.push(name);
		}
	}
	return node;
}

// Drawn as the legacy ContextGatherer drew it: each level adds its connector to its parent's
function renderTree(node: TreeNode, prefix = ''): string {
	let out = `${prefix}${node.name}/`;
	if (node.fileCount > 0 || node.dirCount > 0) {
		out += ` (${node.fileCount} files, ${node.dirCount} dirs)`;
	}
	out += '\n';
	node.children.forEach((child, index) => {
		const childPrefix =
			prefix + (index === node.children.length - 1 ? '└── ' : '├── ');
		out +=
			typeof child === 'string'
				? `${childPrefix}${child}\n`
				: renderTree(child, childPrefix);
	});
	return out;
}

/** The "## Project Structure" section: the project's files, 5 levels deep */
export function gatherProjectTree(projectRoot: string): {
	context: string;
	breakdown: ProjectTreeEntry | null;
} {
	const tree = buildTree(projectRoot, 0);
	if (!tree) return { context: '', breakdown: null };
	const context = `## Project Structure\n\n\`\`\`\n${renderTree(tree)}\n\`\`\``;
	return {
		context,
		breakdown: {
			tokens: estimateTokens(context),
			characters: context.length,
			fileCount: tree.fileCount,
			dirCount: tree.dirCount
		}
	};
}
