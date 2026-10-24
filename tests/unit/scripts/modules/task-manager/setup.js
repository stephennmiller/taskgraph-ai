/**
 * Shared mocks for task-manager module tests
 */
import { vi } from 'vitest';

/**
 * Shared mock implementation for getTagAwareFilePath that matches the actual implementation
 * This ensures consistent behavior across all test files, particularly regarding projectRoot handling.
 *
 * The key difference from previous inconsistent implementations was that some tests were not
 * properly handling the projectRoot parameter, leading to different behaviors between test files.
 *
 * @param {string} basePath - The base file path
 * @param {string|null} tag - The tag name (null, undefined, or 'master' uses base path)
 * @param {string} [projectRoot='.'] - The project root directory
 * @returns {string} The resolved file path
 */
export const createGetTagAwareFilePathMock = () => {
	return vi.fn((basePath, tag, projectRoot = '.') => {
		// Handle projectRoot consistently - this was the key fix
		const fullPath = projectRoot ? `${projectRoot}/${basePath}` : basePath;

		if (!tag || tag === 'master') {
			return fullPath;
		}

		// Mock the slugification behavior (matches actual implementation)
		const slugifiedTag = tag.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
		const idx = fullPath.lastIndexOf('.');
		return `${fullPath.slice(0, idx)}_${slugifiedTag}${fullPath.slice(idx)}`;
	});
};

/**
 * Shared mock implementation for slugifyTagForFilePath that matches the actual implementation
 * @param {string} tagName - The tag name to slugify
 * @returns {string} Slugified tag name safe for filesystem use
 */
export const createSlugifyTagForFilePathMock = () => {
	return vi.fn((tagName) => {
		if (!tagName || typeof tagName !== 'string') {
			return 'unknown-tag';
		}
		return tagName.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
	});
};
