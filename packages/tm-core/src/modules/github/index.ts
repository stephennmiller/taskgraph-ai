/**
 * @fileoverview GitHub module public exports
 */

export { GitHubDomain, type GitHubDomainOptions } from './github-domain.js';
export type { GitHubClient } from './adapters/github-client.interface.js';
export { GhCliClient } from './adapters/gh-cli-client.js';
export { renderIssue } from './services/issue-renderer.js';
export { planSync } from './services/sync-planner.js';
export type * from './types.js';
