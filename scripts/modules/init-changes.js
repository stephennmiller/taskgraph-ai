/** What init changed: before/after snapshots for the summary at the end */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import {
	ENV_EXAMPLE_FILE,
	GITIGNORE_FILE,
	TASKGRAPH_CONFIG_FILE,
	TASKGRAPH_DIR,
	TASKGRAPH_TASKS_FILE
} from '../../src/constants/paths.js';
import { ALIAS_LINE, shellConfigFiles } from './init-shell-aliases.js';

// Committed next to .gitignore; routes tasks.json to the merge driver
const GITATTRIBUTES_FILE = '.gitattributes';

/** Paths whose before/after state the init summary compares */
function trackedPaths(targetDir) {
	return [
		path.join(targetDir, TASKGRAPH_DIR),
		path.join(targetDir, TASKGRAPH_CONFIG_FILE),
		path.join(targetDir, TASKGRAPH_TASKS_FILE),
		path.join(targetDir, '.git'),
		path.join(targetDir, GITIGNORE_FILE),
		path.join(targetDir, GITATTRIBUTES_FILE),
		path.join(targetDir, ENV_EXAMPLE_FILE),
		path.join(targetDir, 'CLAUDE.md'),
		path.join(targetDir, '.mcp.json'),
		...shellConfigFiles()
	];
}

/**
 * Record whether each path exists and, for files, its content.
 * @returns {Map<string, string|null>} null = missing, '' for directories
 */
function snapshotPaths(paths) {
	const snapshot = new Map();
	for (const filePath of paths) {
		let state = null;
		try {
			if (fs.existsSync(filePath)) {
				state = fs.statSync(filePath).isDirectory()
					? ''
					: fs.readFileSync(filePath, 'utf8');
			}
		} catch {
			state = null;
		}
		snapshot.set(filePath, state);
	}
	return snapshot;
}

/**
 * Turn before/after snapshots into the summary's list of changes.
 * @returns {{alreadySetUp: boolean, changes: Array<{path: string, note: string}>}}
 */
function describeInitChanges(targetDir, before, after) {
	const at = (relative) => path.join(targetDir, relative);
	const created = (file) => before.get(file) == null && after.get(file) != null;
	const changed = (file) =>
		before.get(file) != null &&
		after.get(file) != null &&
		before.get(file) !== after.get(file);

	const alreadySetUp =
		before.get(at(TASKGRAPH_CONFIG_FILE)) != null ||
		before.get(at(TASKGRAPH_TASKS_FILE)) != null;
	const changes = [];

	if (!alreadySetUp && after.get(at(TASKGRAPH_CONFIG_FILE)) != null) {
		changes.push({
			path: `${TASKGRAPH_DIR}/`,
			note: 'tasks, settings and PRD templates'
		});
	} else if (alreadySetUp && created(at(TASKGRAPH_CONFIG_FILE))) {
		changes.push({ path: TASKGRAPH_CONFIG_FILE, note: 'restored' });
	}

	if (created(at('.git'))) {
		changes.push({ path: '.git/', note: 'new Git repository' });
	}

	const projectFiles = [
		[GITIGNORE_FILE, 'created', 'added TaskGraph entries'],
		[
			GITATTRIBUTES_FILE,
			'Git merges tasks.json by task; commit it',
			'Git merges tasks.json by task; commit it'
		],
		[ENV_EXAMPLE_FILE, 'optional settings', 'updated'],
		[
			'CLAUDE.md',
			"loads TaskGraph's instructions in Claude Code",
			"now imports TaskGraph's instructions"
		],
		[
			'.mcp.json',
			'TaskGraph MCP server for Claude Code',
			'added the TaskGraph MCP server'
		]
	];
	for (const [relative, createdNote, changedNote] of projectFiles) {
		const file = at(relative);
		if (created(file)) changes.push({ path: relative, note: createdNote });
		else if (changed(file)) changes.push({ path: relative, note: changedNote });
	}

	const homeDir = process.env.HOME || process.env.USERPROFILE;
	for (const file of shellConfigFiles()) {
		const was = before.get(file) || '';
		const now = after.get(file) || '';
		if (now === was) continue;
		if (!now.includes(ALIAS_LINE) || was.includes(ALIAS_LINE)) continue;
		changes.push({
			path: homeDir ? file.replace(homeDir, '~') : file,
			note: 'added the `tm` alias; open a new terminal'
		});
	}

	return { alreadySetUp, changes };
}

/**
 * Whether Git tracks `file` in the repository at `targetDir`.
 * @param {string} targetDir - Project root
 * @param {string} file - Path relative to the project root
 * @returns {boolean} false outside a Git repository
 */
function isTrackedInGit(targetDir, file) {
	try {
		execSync(`git ls-files --error-unmatch -- "${file}"`, {
			cwd: targetDir,
			stdio: 'ignore'
		});
		return true;
	} catch {
		return false;
	}
}

export {
	GITATTRIBUTES_FILE,
	describeInitChanges,
	isTrackedInGit,
	snapshotPaths,
	trackedPaths
};
