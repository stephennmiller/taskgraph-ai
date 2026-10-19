/**
 * @fileoverview GitHub module public exports
 */

export { GitHubDomain, type GitHubDomainOptions } from './github-domain.js';
export type {
	CreateIssueInput,
	GitHubClient,
	UpdateIssueInput
} from './adapters/github-client.interface.js';
export { GhCliClient } from './adapters/gh-cli-client.js';
export { renderIssue, hashIssue } from './services/issue-renderer.js';
export { planSync, getLink } from './services/sync-planner.js';
export { executePush } from './services/push-executor.js';
export type * from './types.js';
