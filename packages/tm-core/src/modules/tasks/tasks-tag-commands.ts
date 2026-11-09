/**
 * @fileoverview Tag management of the tasks domain: create, delete, use,
 * rename and copy tags, and list them with their stats. TasksDomain exposes
 * each one as `tmCore.tasks.<name>`.
 */

import type { TaskService } from './services/task-service.js';
import {
	TagService,
	type CreateTagOptions,
	type DeleteTagOptions,
	type CopyTagOptions
} from './services/tag.service.js';
import {
	createTagFromBranch,
	type CreateBranchTag,
	type CreateTagFromBranchResult
} from './utils/branch-tag.js';

/**
 * Tag commands behind TasksDomain. Build after TaskService.initialize():
 * TagService needs its storage.
 */
export class TaskTagCommands {
	private tagService: TagService;

	constructor(
		private readonly taskService: TaskService,
		private readonly projectRoot: string
	) {
		this.tagService = new TagService(this.taskService.getStorage(), {
			projectRoot: this.projectRoot,
			getActiveTag: () => this.taskService.getActiveTag()
		});
	}

	/**
	 * Create a new tag, empty or with a copy of another tag's tasks
	 */
	async createTag(name: string, options?: CreateTagOptions) {
		return this.tagService.createTag(name, options);
	}

	/**
	 * Create a tag named after the current git branch and map the branch to it
	 * in state.json. createTag writes the tag; see createTagFromBranch in
	 * utils/branch-tag.ts for the checks and errors.
	 */
	async createTagFromBranch<T>(
		createTag: CreateBranchTag<T>
	): Promise<CreateTagFromBranchResult<T>> {
		return createTagFromBranch(this.projectRoot, createTag);
	}

	/**
	 * Delete a tag and its tasks; master becomes current if it was.
	 * Cannot delete master.
	 */
	async deleteTag(name: string, options?: DeleteTagOptions) {
		return this.tagService.deleteTag(name, options);
	}

	/**
	 * Make a tag the current one, and find its next task
	 */
	async useTag(name: string) {
		const result = await this.tagService.useTag(name);
		return { ...result, nextTask: await this.taskService.getNextTask(name) };
	}

	/**
	 * Rename a tag, keeping it current if it was. Cannot rename master.
	 */
	async renameTag(oldName: string, newName: string) {
		return this.tagService.renameTag(oldName, newName);
	}

	/**
	 * Copy an existing tag to create a new tag with the same tasks
	 */
	async copyTag(source: string, target: string, options?: CopyTagOptions) {
		return this.tagService.copyTag(source, target, options);
	}

	/**
	 * Get all tags with detailed statistics including task counts
	 * @param options.ready - Only tags with at least one task ready to start
	 */
	async getTagsWithStats(options: { ready?: boolean } = {}) {
		const result = await this.tagService.getTagsWithStats();
		if (!options.ready) return result;
		const tags = result.tags.filter((tag) => tag.readyTasks > 0);
		return { ...result, tags, totalTags: tags.length };
	}

	/**
	 * The tags to list, current first, every field filled in (see TagService)
	 * @param options.ready - Only tags with at least one task ready to start
	 */
	async listTags(options: { ready?: boolean } = {}) {
		return this.tagService.listTags(options);
	}
}
