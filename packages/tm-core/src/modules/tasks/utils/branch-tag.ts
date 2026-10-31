/**
 * @fileoverview Create a tag named after the current git branch, and remember
 * which tag each branch maps to (`branchTagMapping` in state.json) and which
 * tag is current (`currentTag`).
 */

import path from 'node:path';
import { TASKGRAPH_STATE_FILE } from '../../../common/constants/paths.js';
import {
	ERROR_CODES,
	TaskGraphError
} from '../../../common/errors/taskgraph-error.js';
import { getLogger } from '../../../common/logger/index.js';
import {
	getCurrentBranch,
	isGitRepository,
	isValidBranchForTag,
	sanitizeBranchNameForTag
} from '../../../common/utils/git-utils.js';
import { stateFileError } from '../../config/services/runtime-state-manager.service.js';
import { FileOperations } from '../../storage/adapters/file-storage/file-operations.js';

/** A git branch and the tag name it maps to */
export interface BranchTag {
	branchName: string;
	tagName: string;
}

/**
 * Writes the new tag. The caller supplies it, so the tag is written the same
 * way as one created by name.
 */
export type CreateBranchTag<T> = (
	tagName: string,
	options: {
		/** The description to store when the caller has none of its own */
		defaultDescription: string;
	}
) => Promise<T>;

export interface CreateTagFromBranchResult<T> extends BranchTag {
	/** What the caller's createTag returned */
	created: T;
	/** False when the tag was created but state.json could not be updated */
	mappingUpdated: boolean;
}

/**
 * The tag name for a branch: lowercase, with anything outside letters,
 * digits, `_` and `-` turned into `-`.
 * @throws {TaskGraphError} INVALID_BRANCH_FOR_TAG for a branch such as `main`
 *   that should not become a tag, or one with nothing usable in its name
 */
export function tagNameForBranch(branchName: string): string {
	if (!isValidBranchForTag(branchName)) {
		throw new TaskGraphError(
			`Branch "${branchName}" cannot be converted to a valid tag name`,
			ERROR_CODES.INVALID_BRANCH_FOR_TAG,
			{ details: { branchName } }
		);
	}
	return sanitizeBranchNameForTag(branchName);
}

/**
 * The branch checked out in projectRoot, and its tag name.
 * @throws {TaskGraphError} NOT_GIT_REPO outside a git repository,
 *   NO_CURRENT_BRANCH when no branch is checked out (including a detached
 *   HEAD), INVALID_BRANCH_FOR_TAG as in tagNameForBranch
 */
export async function resolveBranchTag(
	projectRoot: string
): Promise<BranchTag> {
	if (!(await isGitRepository(projectRoot))) {
		throw new TaskGraphError(
			'Not in a git repository',
			ERROR_CODES.NOT_GIT_REPO,
			{ details: { projectRoot } }
		);
	}
	const branchName = await getCurrentBranch(projectRoot);
	// A detached checkout reports the branch as "HEAD"
	if (!branchName || branchName === 'HEAD') {
		throw new TaskGraphError(
			'Could not determine the current git branch',
			ERROR_CODES.NO_CURRENT_BRANCH,
			{ details: { projectRoot } }
		);
	}
	return { branchName, tagName: tagNameForBranch(branchName) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Change state.json under projectRoot in place. Every key the change leaves
 * alone is kept as it is; a missing file is created.
 */
async function updateStateFile(
	projectRoot: string,
	change: (state: Record<string, unknown>) => void
): Promise<void> {
	await new FileOperations().modifyJson(
		path.join(projectRoot, TASKGRAPH_STATE_FILE),
		(state: unknown) => {
			// JSON.stringify drops a key set on an array, so the change would be lost
			if (!isRecord(state)) {
				throw new Error('state.json does not hold a JSON object');
			}
			change(state);
			return state;
		}
	);
}

/**
 * Record in state.json that branchName maps to tagName. Every other key in
 * the file is kept as it is; a missing file is created.
 */
export async function recordBranchTag(
	projectRoot: string,
	branchName: string,
	tagName: string
): Promise<void> {
	await updateStateFile(projectRoot, (state) => {
		const mapping = isRecord(state.branchTagMapping)
			? (state.branchTagMapping as Record<string, string>)
			: {};
		mapping[branchName] = tagName;
		state.branchTagMapping = mapping;
	});
}

/**
 * Change state.json, failing with the file's path and the way out
 * @throws {TaskGraphError} when state.json can't be read or saved
 */
async function saveStateFile(
	projectRoot: string,
	change: (state: Record<string, unknown>) => void
): Promise<void> {
	try {
		await updateStateFile(projectRoot, change);
	} catch (error) {
		throw stateFileError(
			'save',
			path.join(projectRoot, TASKGRAPH_STATE_FILE),
			error
		);
	}
}

/**
 * Check that state.json can be saved, before a tag change that must be
 * followed by recordCurrentTag: the change can't be undone once made (#807)
 * @throws {TaskGraphError} as recordCurrentTag does
 */
export async function assertStateWritable(projectRoot: string): Promise<void> {
	await saveStateFile(projectRoot, () => {});
}

/**
 * Make tagName the current tag in state.json.
 * @throws {TaskGraphError} when state.json can't be saved, so the caller
 * never reports a switch that didn't happen
 */
export async function recordCurrentTag(
	projectRoot: string,
	tagName: string
): Promise<void> {
	await saveStateFile(projectRoot, (state) => {
		state.currentTag = tagName;
		state.lastSwitched = new Date().toISOString();
		state.branchTagMapping ??= {};
		state.migrationNoticeShown ??= false;
	});
}

/**
 * Create a tag named after the branch checked out in projectRoot, then map
 * the branch to it in state.json. Nothing is written when the branch check
 * fails or createTag throws. A failed state.json update does not undo the
 * tag: it is logged and reported as `mappingUpdated: false`.
 * @throws {TaskGraphError} as in resolveBranchTag, or whatever createTag throws
 */
export async function createTagFromBranch<T>(
	projectRoot: string,
	createTag: CreateBranchTag<T>
): Promise<CreateTagFromBranchResult<T>> {
	const { branchName, tagName } = await resolveBranchTag(projectRoot);
	const created = await createTag(tagName, {
		defaultDescription: `Tag created from git branch "${branchName}"`
	});

	let mappingUpdated = true;
	try {
		await recordBranchTag(projectRoot, branchName, tagName);
	} catch (error) {
		mappingUpdated = false;
		getLogger('BranchTag').warn(
			`Could not update branch-tag mapping: ${(error as Error).message}`
		);
	}
	return { branchName, tagName, created, mappingUpdated };
}
