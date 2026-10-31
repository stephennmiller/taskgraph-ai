/**
 * @fileoverview TagService - Business logic for tag management
 * Handles tag creation, deletion, switching, renaming, copying and listing
 */

import type {
	IStorage,
	TagInfo
} from '../../../common/interfaces/storage.interface.js';
import {
	ERROR_CODES,
	TaskGraphError
} from '../../../common/errors/taskgraph-error.js';
import { assertStateWritable, recordCurrentTag } from '../utils/branch-tag.js';
import { assertTagName, isReservedNewTagName } from '../utils/tag-names.js';

/**
 * Options for creating a new tag
 */
export interface CreateTagOptions {
	/** Copy tasks from current tag */
	copyFromCurrent?: boolean;
	/** Copy tasks from specific tag */
	copyFromTag?: string;
	/** Tag description */
	description?: string;
	/** Stored when description is empty */
	defaultDescription?: string;
}

/**
 * Options for deleting a tag
 */
export interface DeleteTagOptions {
	/**
	 * Asked before deleting a tag that has tasks; false keeps the tag. The
	 * caller owns the question (a CLI prompt); omit it to delete without asking.
	 */
	confirm?: (taskCount: number) => Promise<boolean>;
}

/**
 * Options for copying a tag
 */
export interface CopyTagOptions {
	/** Description for the new tag */
	description?: string;
}

export interface CreateTagResult {
	tagName: string;
	created: true;
	tasksCopied: number;
	/** The tag the tasks were copied from, or null for an empty tag */
	sourceTag: string | null;
	/** The description stored */
	description: string;
}

export type DeleteTagResult =
	| {
			tagName: string;
			deleted: true;
			tasksDeleted: number;
			wasCurrentTag: boolean;
			/** The current tag was deleted, so master is current now */
			switchedToMaster: boolean;
	  }
	| { tagName: string; deleted: false; cancelled: true };

export interface UseTagResult {
	previousTag: string;
	currentTag: string;
	switched: true;
	taskCount: number;
}

export interface RenameTagResult {
	oldName: string;
	newName: string;
	renamed: true;
	taskCount: number;
	wasCurrentTag: boolean;
	isCurrentTag: boolean;
}

export interface CopyTagResult {
	sourceName: string;
	targetName: string;
	copied: true;
	tasksCopied: number;
	/** The description stored */
	description: string;
}

/** A tag as `tags` lists it: every field filled in */
type ListedTag = Required<
	Pick<
		TagInfo,
		| 'name'
		| 'isCurrent'
		| 'taskCount'
		| 'completedTasks'
		| 'readyTasks'
		| 'statusBreakdown'
		| 'subtaskCounts'
		| 'created'
		| 'description'
	>
>;

export interface ListTagsResult {
	/** The current tag first, then by name */
	tags: ListedTag[];
	currentTag: string | null;
	totalTags: number;
}

/**
 * Names no new tag may take: the default tag, and names that would be
 * confused with it
 */
const RESERVED_TAG_NAMES = ['master', 'main', 'default'];

/** What TagService needs from the project beyond storage */
export interface TagServiceContext {
	projectRoot: string;
	/** The current tag, as state.json records it */
	getActiveTag: () => string;
}

function validationError(message: string, hint?: string): TaskGraphError {
	const error = new TaskGraphError(message, ERROR_CODES.VALIDATION_ERROR);
	// The CLI prints the hint under the message
	return hint ? Object.assign(error, { hint }) : error;
}

function requireName(name: unknown, what: string): asserts name is string {
	if (!name || typeof name !== 'string') {
		throw validationError(`${what} is required and must be a string`);
	}
}

/** Today's date as the user's locale writes it, for default descriptions */
function today(): string {
	return new Date().toLocaleDateString();
}

/**
 * TagService - Handles tag management business logic
 * Validates operations and delegates to storage layer
 */
export class TagService {
	constructor(
		private storage: IStorage,
		private readonly context: TagServiceContext
	) {}

	/**
	 * The name of a tag about to be created (or a rename or copy target)
	 * @throws {TaskGraphError} if the name has other characters or is reserved
	 */
	private validateNewTagName(name: string): void {
		assertTagName(name);
		if (
			RESERVED_TAG_NAMES.includes(name.toLowerCase()) ||
			isReservedNewTagName(name)
		) {
			throw validationError(`"${name}" is a reserved tag name`);
		}
	}

	/**
	 * @returns Every tag in the file
	 * @throws {TaskGraphError} NOT_FOUND when the tag is not in the file
	 */
	private async requireTag(name: string, what = 'Tag'): Promise<string[]> {
		const tags = await this.storage.getAllTags();
		if (!tags.includes(name)) {
			throw new TaskGraphError(
				`${what} "${name}" does not exist`,
				ERROR_CODES.NOT_FOUND,
				{ tagName: name }
			);
		}
		return tags;
	}

	/**
	 * Create a new tag, empty or with a copy of another tag's tasks. A source
	 * tag that is missing or empty gives an empty tag (tasksCopied 0).
	 */
	async createTag(
		name: string,
		options: CreateTagOptions = {}
	): Promise<CreateTagResult> {
		requireName(name, 'Tag name');
		this.validateNewTagName(name);

		const sourceTag =
			options.copyFromTag ||
			(options.copyFromCurrent ? this.context.getActiveTag() : null);
		const description =
			options.description ||
			options.defaultDescription ||
			`Tag created on ${today()}`;

		const tasksCopied = await this.storage.createTag(name, {
			copyFrom: sourceTag ?? undefined,
			description
		});
		return {
			tagName: name,
			created: true,
			tasksCopied,
			sourceTag,
			description
		};
	}

	/**
	 * Delete a tag and its tasks. Deleting the current tag makes master
	 * current. Cannot delete master.
	 */
	async deleteTag(
		name: string,
		options: DeleteTagOptions = {}
	): Promise<DeleteTagResult> {
		requireName(name, 'Tag name');
		if (name === 'master') {
			throw validationError('Cannot delete the "master" tag');
		}
		await this.requireTag(name);

		const wasCurrentTag = this.context.getActiveTag() === name;
		const tasksDeleted = (await this.storage.loadTasks(name)).length;
		if (
			options.confirm &&
			tasksDeleted > 0 &&
			!(await options.confirm(tasksDeleted))
		) {
			return { tagName: name, deleted: false, cancelled: true };
		}

		if (wasCurrentTag) await assertStateWritable(this.context.projectRoot);
		await this.storage.deleteTag(name);
		if (wasCurrentTag) {
			await recordCurrentTag(this.context.projectRoot, 'master');
		}
		return {
			tagName: name,
			deleted: true,
			tasksDeleted,
			wasCurrentTag,
			switchedToMaster: wasCurrentTag
		};
	}

	/**
	 * Make a tag the current one (in state.json)
	 */
	async useTag(name: string): Promise<UseTagResult> {
		requireName(name, 'Tag name');
		await this.requireTag(name);

		const previousTag = this.context.getActiveTag();
		await recordCurrentTag(this.context.projectRoot, name);
		const taskCount = (await this.storage.loadTasks(name)).length;
		return { previousTag, currentTag: name, switched: true, taskCount };
	}

	/**
	 * Rename a tag, keeping it current if it was. Cannot rename master.
	 */
	async renameTag(oldName: string, newName: string): Promise<RenameTagResult> {
		requireName(oldName, 'Old tag name');
		requireName(newName, 'New tag name');
		if (oldName === 'master') {
			throw validationError('Cannot rename the "master" tag');
		}
		this.validateNewTagName(newName);
		const tags = await this.requireTag(oldName);
		if (tags.includes(newName)) {
			throw validationError(`Tag "${newName}" already exists`);
		}

		const wasCurrentTag = this.context.getActiveTag() === oldName;
		if (wasCurrentTag) await assertStateWritable(this.context.projectRoot);
		await this.storage.renameTag(oldName, newName);
		if (wasCurrentTag) {
			await recordCurrentTag(this.context.projectRoot, newName);
		}
		const taskCount = (await this.storage.loadTasks(newName)).length;
		return {
			oldName,
			newName,
			renamed: true,
			taskCount,
			wasCurrentTag,
			isCurrentTag: wasCurrentTag
		};
	}

	/**
	 * Copy a tag with all its tasks to a new tag
	 */
	async copyTag(
		sourceName: string,
		targetName: string,
		options: CopyTagOptions = {}
	): Promise<CopyTagResult> {
		requireName(sourceName, 'Source tag name');
		requireName(targetName, 'Target tag name');
		this.validateNewTagName(targetName);
		await this.requireTag(sourceName, 'Source tag');

		const description =
			options.description || `Copy of "${sourceName}" created on ${today()}`;
		const tasksCopied = await this.storage.copyTag(sourceName, targetName, {
			description
		});
		return {
			sourceName,
			targetName,
			copied: true,
			tasksCopied,
			description
		};
	}

	/**
	 * Get all tags with statistics
	 */
	async getTagsWithStats() {
		return await this.storage.getTagsWithStats();
	}

	/**
	 * The tags to list: the current tag first, then by name, with every field
	 * filled in. A project with no tasks file yet lists an empty master.
	 * @param options.ready - Only tags with at least one task ready to start
	 */
	async listTags(options: { ready?: boolean } = {}): Promise<ListTagsResult> {
		const { tags, currentTag } = await this.storage.getTagsWithStats();
		const found: TagInfo[] =
			tags.length > 0
				? tags
				: [
						{
							name: 'master',
							isCurrent: currentTag === 'master',
							taskCount: 0,
							completedTasks: 0,
							readyTasks: 0,
							statusBreakdown: {}
						}
					];
		const listed = found
			.filter((tag) => !options.ready || tag.readyTasks > 0)
			.map(
				(tag): ListedTag => ({
					name: tag.name,
					isCurrent: tag.isCurrent,
					taskCount: tag.taskCount,
					completedTasks: tag.completedTasks,
					readyTasks: tag.readyTasks,
					statusBreakdown: tag.statusBreakdown,
					subtaskCounts: tag.subtaskCounts ?? {
						totalSubtasks: 0,
						subtasksByStatus: {}
					},
					created: tag.created || 'Unknown',
					description: tag.description || 'No description'
				})
			)
			.sort((a, b) =>
				a.isCurrent !== b.isCurrent
					? a.isCurrent
						? -1
						: 1
					: a.name.localeCompare(b.name)
			);
		return { tags: listed, currentTag, totalTags: listed.length };
	}
}
