import { describe, expect, it, vi } from 'vitest';
import type { IStorage } from '../../../common/interfaces/storage.interface.js';
import { TagService } from './tag.service.js';

/** Storage holding the given tags; only what TagService calls */
function storageWithTags(tags: string[]) {
	return {
		getAllTags: vi.fn().mockResolvedValue(tags),
		createTag: vi.fn().mockResolvedValue(undefined),
		deleteTag: vi.fn().mockResolvedValue(undefined),
		renameTag: vi.fn().mockResolvedValue(undefined),
		copyTag: vi.fn().mockResolvedValue(undefined)
	};
}

function serviceWith(storage: ReturnType<typeof storageWithTags>) {
	return new TagService(storage as unknown as IStorage);
}

// The legacy code that also writes tasks.json uses these keys as its own
// fields and dropped a tag with either name on its next write (#399)
describe.each(['tag', '_rawTaggedData'])('TagService and a tag named %s', (name) => {
	it('refuses it as a new tag', async () => {
		const storage = storageWithTags(['master']);

		await expect(serviceWith(storage).createTag(name)).rejects.toThrow(
			`"${name}" is a reserved tag name`
		);
		expect(storage.createTag).not.toHaveBeenCalled();
	});

	it('refuses it as a rename target', async () => {
		const storage = storageWithTags(['master', 'feature']);

		await expect(
			serviceWith(storage).renameTag('feature', name)
		).rejects.toThrow(`"${name}" is a reserved tag name`);
		expect(storage.renameTag).not.toHaveBeenCalled();
	});

	it('refuses it as a copy target', async () => {
		const storage = storageWithTags(['master', 'feature']);

		await expect(serviceWith(storage).copyTag('feature', name)).rejects.toThrow(
			`"${name}" is a reserved tag name`
		);
		expect(storage.copyTag).not.toHaveBeenCalled();
	});

	it('still renames or deletes one already in the file', async () => {
		const storage = storageWithTags(['master', name]);
		const service = serviceWith(storage);

		await service.renameTag(name, 'renamed');
		await service.deleteTag(name);

		expect(storage.renameTag).toHaveBeenCalledWith(name, 'renamed');
		expect(storage.deleteTag).toHaveBeenCalledWith(name);
	});
});
