import type { Task } from '../../src/common/types/index.js';
import type { FileStorage } from '../../src/modules/storage/adapters/file-storage/file-storage.js';

/** Add tasks to a tag through the public write path, creating the tag if the file lacks it */
export async function seedTasks(
	storage: FileStorage,
	tasks: Task[],
	tag = 'master'
): Promise<void> {
	const tags = await storage.getAllTags();
	if (tags.length > 0 && !tags.includes(tag)) await storage.createTag(tag);
	await storage.appendTasks(tasks, tag);
}
