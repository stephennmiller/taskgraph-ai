/**
 * @fileoverview In-memory GitHub client and task builder shared by the
 * GitHub sync integration tests.
 */

import type { Task } from '../../../src/common/types/index.js';
import type {
	CreateIssueInput,
	GitHubClient,
	UpdateIssueInput
} from '../../../src/modules/github/adapters/github-client.interface.js';
import type { RemoteIssue } from '../../../src/modules/github/types.js';

export const REPO = 'acme/app';

export class FakeGitHub implements GitHubClient {
	issues: RemoteIssue[] = [];
	async getRepo() {
		return { fullName: REPO, url: `https://github.com/${REPO}` };
	}
	async listIssues(label?: string, state: 'open' | 'all' = 'all') {
		return this.issues
			.filter((i) => !label || i.labels.includes(label))
			.filter((i) => state === 'all' || i.state === 'open')
			.map((i) => ({ ...i }));
	}
	async createIssue(input: CreateIssueInput) {
		const number = this.issues.length + 1;
		const issue: RemoteIssue = {
			number,
			url: `https://github.com/${REPO}/issues/${number}`,
			state: 'open',
			assignees: [],
			...input
		};
		this.issues.push(issue);
		return { ...issue };
	}
	async updateIssue(number: number, input: UpdateIssueInput) {
		const issue = this.issues.find((i) => i.number === number);
		if (!issue) throw new Error(`no issue ${number}`);
		Object.assign(issue, input);
		return { ...issue };
	}
	async ensureLabels() {}
}

export const makeTask = (id: string, overrides: Partial<Task> = {}): Task => ({
	id,
	title: `Task ${id}`,
	description: `Description ${id}`,
	status: 'pending',
	priority: 'medium',
	dependencies: [],
	details: '',
	testStrategy: '',
	subtasks: [],
	...overrides
});
