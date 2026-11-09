/**
 * @fileoverview init's .gitignore: create it from the template, or merge the
 * template's missing lines into the user's file, with the task files section
 * commented out (tasks committed) or not (tasks ignored)
 */
import fs from 'node:fs';
import path from 'node:path';
import { TASKGRAPH_TASKS_DIR } from '../../common/constants/paths.js';
import { writeProjectFile } from '../storage/adapters/file-storage/file-operations.js';

/** .gitignore sits in the project root; init allows it to link within the project */
const writeGitignore = (targetPath: string, text: string) =>
	writeProjectFile(path.dirname(targetPath), targetPath, text, {
		linkInProject: true
	});

/** Where the merge reports what it did: init's debug log and warnings */
export type GitignoreLog = (
	level: 'debug' | 'success' | 'error',
	message: string
) => void;

// Constants
export const TASK_FILES_COMMENT = '# Task files';
/** Has a slash before its end, so git matches it from the .gitignore's folder only */
export const TASK_DIR_PATTERN = `${TASKGRAPH_TASKS_DIR}/`;
/**
 * What init wrote before #1105. They match any `tasks` folder or `tasks.json`
 * in the repo, and a user may have the same lines for their own files, so
 * they count as init's only under its "# Task files" header.
 */
const LEGACY_TASK_PATTERNS = ['tasks.json', 'tasks/'];

/**
 * Normalizes a line by removing comments and trimming whitespace
 * @param {string} line - Line to normalize
 * @returns {string} Normalized line
 */
export function normalizeLine(line: string): string {
	return line.trim().replace(/^#/, '').trim();
}

/**
 * Checks if a line under the "# Task files" header is one init wrote there,
 * commented out or not: the tasks folder, or the pair older releases wrote
 * @param {string} line - Line to check
 * @returns {boolean} True if line is task-related
 */
export function isTaskLine(line: string): boolean {
	const normalized = normalizeLine(line);
	return (
		normalized === TASK_DIR_PATTERN || LEGACY_TASK_PATTERNS.includes(normalized)
	);
}

/**
 * Removes init's task files section: its header, the task lines right under
 * it and the blank lines after them. A task line anywhere else is the
 * user's own and stays.
 * @param {string[]} existingLines - Existing file lines
 * @returns {string[]} Lines with task section removed
 */
function removeExistingTaskSection(existingLines: string[]): string[] {
	const cleanedLines: string[] = [];
	let section: 'none' | 'tasks' | 'blanks' = 'none';

	for (const line of existingLines) {
		if (line.trim() === TASK_FILES_COMMENT) {
			section = 'tasks';
			continue;
		}
		if (section === 'tasks' && isTaskLine(line)) continue;
		// A task line after the blank lines is no longer under the header
		if (section !== 'none' && !line.trim()) {
			section = 'blanks';
			continue;
		}
		section = 'none';
		cleanedLines.push(line);
	}

	return cleanedLines;
}

/**
 * Filters template lines to only include new content not already present
 * @param {string[]} templateLines - Template lines
 * @param {Set<string>} existingLinesSet - Set of existing trimmed lines
 * @returns {string[]} New lines to add
 */
function filterNewTemplateLines(
	templateLines: string[],
	existingLinesSet: Set<string>
): string[] {
	return templateLines.filter((line) => {
		const trimmed = line.trim();
		return trimmed !== '' && !existingLinesSet.has(trimmed);
	});
}

/**
 * Builds the task files section based on storage preference
 * @param {boolean} storeTasksInGit - Whether to comment out task lines
 * @returns {string[]} Task files section lines
 */
export function buildTaskFilesSection(storeTasksInGit: boolean): string[] {
	return [
		TASK_FILES_COMMENT,
		storeTasksInGit ? `# ${TASK_DIR_PATTERN}` : TASK_DIR_PATTERN
	];
}

/**
 * End the template with the task files section, laid out the way a merge
 * writes it
 * @param {string[]} templateLines - Template lines without a task section
 * @param {boolean} storeTasksInGit - Whether to comment out task lines
 * @returns {string[]} Lines with exactly one task files section
 */
function withTaskFilesSection(
	templateLines: string[],
	storeTasksInGit: boolean
): string[] {
	const lines = [...templateLines];
	while (lines.length > 0 && !lines[lines.length - 1].trim()) lines.pop();
	addSeparatorIfNeeded(lines);
	lines.push(...buildTaskFilesSection(storeTasksInGit));
	return lines;
}

/**
 * Adds a separator line if needed (avoids double spacing)
 * @param {string[]} lines - Current lines array
 */
function addSeparatorIfNeeded(lines: string[]): void {
	if (lines.some((line) => line.trim())) {
		const lastLine = lines[lines.length - 1];
		if (lastLine && lastLine.trim()) {
			lines.push('');
		}
	}
}

/**
 * Validates input parameters
 * @param {string} targetPath - Path to .gitignore file
 * @param {string} content - Template content
 * @param {boolean} storeTasksInGit - Storage preference
 * @throws {Error} If validation fails
 */
function validateInputs(
	targetPath: unknown,
	content: unknown,
	storeTasksInGit: unknown
): void {
	if (!targetPath || typeof targetPath !== 'string') {
		throw new Error('targetPath must be a non-empty string');
	}

	if (!targetPath.endsWith('.gitignore')) {
		throw new Error('targetPath must end with .gitignore');
	}

	if (!content || typeof content !== 'string') {
		throw new Error('content must be a non-empty string');
	}

	if (typeof storeTasksInGit !== 'boolean') {
		throw new Error('storeTasksInGit must be a boolean');
	}
}

/**
 * Creates a new .gitignore file from template
 * @param {string} targetPath - Path to create file at
 * @param {string[]} templateLines - Adjusted template lines
 * @param {function} log - Logging function
 */
function createNewGitignoreFile(
	targetPath: string,
	templateLines: string[],
	log: GitignoreLog | null
): void {
	try {
		writeGitignore(targetPath, templateLines.join('\n') + '\n');
		if (typeof log === 'function') {
			log('success', `Created ${targetPath} with full template`);
		}
	} catch (error) {
		if (typeof log === 'function') {
			log(
				'error',
				`Failed to create ${targetPath}: ${(error as Error).message}`
			);
		}
		throw error;
	}
}

/**
 * Merges template content with existing .gitignore file
 * @param {string} targetPath - Path to existing file
 * @param {string[]} templateLines - Adjusted template lines
 * @param {boolean} storeTasksInGit - Storage preference
 * @param {function} log - Logging function
 */
function mergeWithExistingFile(
	targetPath: string,
	templateLines: string[],
	storeTasksInGit: boolean,
	log: GitignoreLog | null
): void {
	try {
		// Read and process existing file
		const existingContent = fs.readFileSync(targetPath, 'utf8');
		const existingLines = existingContent.split('\n');

		// Remove existing task section
		const cleanedExistingLines = removeExistingTaskSection(existingLines);

		// Find new template lines to add
		const existingLinesSet = new Set(
			cleanedExistingLines.map((line) => line.trim()).filter((line) => line)
		);
		const newLines = filterNewTemplateLines(templateLines, existingLinesSet);

		// Build final content
		const finalLines = [...cleanedExistingLines];

		// Add new template content
		if (newLines.length > 0) {
			addSeparatorIfNeeded(finalLines);
			finalLines.push(...newLines);
		}

		// Add task files section
		addSeparatorIfNeeded(finalLines);
		finalLines.push(...buildTaskFilesSection(storeTasksInGit));

		// Write result
		writeGitignore(targetPath, finalLines.join('\n') + '\n');

		if (typeof log === 'function') {
			const hasNewContent =
				newLines.length > 0 ? ' and merged new content' : '';
			log(
				'debug',
				`Updated ${targetPath} according to user preference${hasNewContent}`
			);
		}
	} catch (error) {
		if (typeof log === 'function') {
			log(
				'error',
				`Failed to merge content with ${targetPath}: ${(error as Error).message}`
			);
		}
		throw error;
	}
}

/**
 * Read the task storage choice an earlier init wrote to .gitignore, so
 * re-running `init --yes` keeps it instead of resetting it to the default.
 * @param {string} targetPath - Path to the .gitignore file
 * @returns {boolean|undefined} true when tasks are committed, false when
 *   they're ignored, undefined when the file has no task files section
 */
export function readStoreTasksInGit(targetPath: string): boolean | undefined {
	try {
		if (!fs.existsSync(targetPath)) return undefined;
		const lines = fs.readFileSync(targetPath, 'utf8').split('\n');
		const header = lines.findIndex(
			(line) => line.trim() === TASK_FILES_COMMENT
		);
		const taskLine = header === -1 ? undefined : lines[header + 1];
		return taskLine === undefined || !isTaskLine(taskLine)
			? undefined
			: taskLine.trim().startsWith('#');
	} catch {
		return undefined;
	}
}

/**
 * Manages .gitignore file creation and updates with task file preferences
 * @param {string} targetPath - Path to the .gitignore file
 * @param {string} content - Template content for .gitignore
 * @param {boolean} storeTasksInGit - Whether to store tasks in git or not
 * @param {function} log - Logging function (level, message)
 * @throws {Error} If validation or file operations fail
 */
export function manageGitignoreFile(
	targetPath: string,
	content: string,
	storeTasksInGit = true,
	log: GitignoreLog | null = null
): void {
	// Validate inputs
	validateInputs(targetPath, content, storeTasksInGit);

	// The task files section is always written from here, never from the template
	const adjustedTemplateLines = removeExistingTaskSection(content.split('\n'));

	// Handle file creation or merging
	if (!fs.existsSync(targetPath)) {
		createNewGitignoreFile(
			targetPath,
			withTaskFilesSection(adjustedTemplateLines, storeTasksInGit),
			log
		);
	} else {
		mergeWithExistingFile(
			targetPath,
			adjustedTemplateLines,
			storeTasksInGit,
			log
		);
	}
}
