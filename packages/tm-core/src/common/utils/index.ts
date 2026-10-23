/**
 * @fileoverview Utility functions for the tm-core package
 * This file exports all utility functions and helper classes
 */

// Export git utilities
export {
	isGitRepository,
	isGitRepositorySync,
	getCurrentBranch,
	getCurrentBranchSync,
	getLocalBranches,
	getRemoteBranches,
	isGhCliAvailable,
	getGitHubRepoInfo,
	getGitRepositoryRoot,
	getDefaultBranch,
	isOnDefaultBranch,
	insideGitWorkTree,
	sanitizeBranchNameForTag,
	isValidBranchForTag,
	type GitHubRepoInfo
} from './git-utils.js';

// Export path normalization utilities
export {
	normalizeProjectPath,
	denormalizeProjectPath,
	isValidNormalizedPath
} from './path-normalizer.js';

// Export run ID generation utilities
export {
	generateRunId,
	isValidRunId,
	parseRunId,
	compareRunIds
} from './run-id-generator.js';

// Export project root finding utilities
export {
	PROJECT_ROOT_ENV,
	findProjectRoot,
	isTaskGraphProject,
	namedProjectRoot,
	normalizeProjectRoot,
	resolveProjectRoot
} from './project-root-finder.js';

// Export path construction utilities
export { getProjectPaths } from './path-helpers.js';

// Export the version stamp for --json output
export {
	JSON_OUTPUT_SCHEMA_VERSION,
	toVersionedJson,
	type VersionedJson
} from './json-output.js';

// Own-key access that ignores the prototype (`constructor`, `__proto__` keys)
export { getOwnKey, setOwnKey } from './own-key.js';
