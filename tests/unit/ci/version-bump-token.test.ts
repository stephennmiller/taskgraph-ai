/**
 * The version-bump job pushes a commit and a tag to main. A ruleset requires
 * pull requests, and the GitHub Actions app cannot be a bypass actor on a
 * user-owned repo, so the push authenticates as a bypass-listed GitHub App.
 * The credential must be a short-lived installation token minted in the job,
 * not the long-lived RELEASE_TOKEN personal access token (issue #717).
 */

import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';

const WORKFLOW_PATH = '.github/workflows/version-bump.yml';
const PINNED_APP_TOKEN_ACTION =
	/^actions\/create-github-app-token@[0-9a-f]{40}$/;
const MINTED_TOKEN = '${{ steps.release-token.outputs.token }}';

type Step = {
	id?: string;
	uses?: string;
	with?: Record<string, unknown>;
};

type Workflow = {
	jobs?: {
		bump?: {
			steps?: Step[];
		};
	};
};

function releaseCredentialProblems(workflow: Workflow): string[] {
	const steps = workflow.jobs?.bump?.steps;
	if (!Array.isArray(steps)) return ['bump job has no steps'];

	const problems: string[] = [];
	const mint = steps.find(
		(step) =>
			typeof step.uses === 'string' && PINNED_APP_TOKEN_ACTION.test(step.uses)
	);

	if (!mint) {
		problems.push(
			'bump job does not mint a token with a sha-pinned actions/create-github-app-token'
		);
	} else {
		if (mint.id !== 'release-token') {
			problems.push('token step id must be release-token');
		}
		const inputs = mint.with ?? {};
		if (inputs['client-id'] !== '${{ secrets.RELEASE_APP_CLIENT_ID }}') {
			problems.push('token step must take the app client id from secrets');
		}
		if (inputs['private-key'] !== '${{ secrets.RELEASE_APP_PRIVATE_KEY }}') {
			problems.push('token step must take the app private key from secrets');
		}
		if (inputs['permission-contents'] !== 'write') {
			problems.push('installation token must be scoped to contents: write');
		}
		if (inputs['skip-token-revoke'] !== undefined) {
			problems.push('installation token must be revoked when the job ends');
		}
		if (inputs.repositories !== undefined || inputs.owner !== undefined) {
			problems.push('installation token must stay limited to this repository');
		}
	}

	for (const step of steps) {
		const token = step.with?.token;
		if (typeof token === 'string' && token.includes('secrets.')) {
			problems.push(`step uses a stored secret as a credential (${token})`);
		}
	}

	const checkout = steps.find(
		(step) =>
			typeof step.uses === 'string' &&
			step.uses.startsWith('actions/checkout@') &&
			step.with?.ref === 'main'
	);
	if (checkout?.with?.token !== MINTED_TOKEN) {
		problems.push('checkout of main must use the minted installation token');
	}

	return problems;
}

const appTokenStep: Step = {
	id: 'release-token',
	uses: 'actions/create-github-app-token@64ab729a6294000f5aa4a4bc0b73d1f32bc45510',
	with: {
		'client-id': '${{ secrets.RELEASE_APP_CLIENT_ID }}',
		'private-key': '${{ secrets.RELEASE_APP_PRIVATE_KEY }}',
		'permission-contents': 'write'
	}
};

describe('releaseCredentialProblems', () => {
	it('rejects a checkout that uses the long-lived RELEASE_TOKEN secret', () => {
		const workflow: Workflow = {
			jobs: {
				bump: {
					steps: [
						{
							uses: 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
							with: {
								ref: 'main',
								token: '${{ secrets.RELEASE_TOKEN }}'
							}
						}
					]
				}
			}
		};

		expect(releaseCredentialProblems(workflow)).toEqual([
			'bump job does not mint a token with a sha-pinned actions/create-github-app-token',
			'step uses a stored secret as a credential (${{ secrets.RELEASE_TOKEN }})',
			'checkout of main must use the minted installation token'
		]);
	});

	it('accepts a sha-pinned app token scoped to contents on this repo', () => {
		const workflow: Workflow = {
			jobs: {
				bump: {
					steps: [
						appTokenStep,
						{
							uses: 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
							with: { ref: 'main', token: MINTED_TOKEN }
						}
					]
				}
			}
		};

		expect(releaseCredentialProblems(workflow)).toEqual([]);
	});

	it('rejects an unpinned app-token action', () => {
		const workflow: Workflow = {
			jobs: {
				bump: {
					steps: [
						{ ...appTokenStep, uses: 'actions/create-github-app-token@v3' },
						{
							uses: 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
							with: { ref: 'main', token: MINTED_TOKEN }
						}
					]
				}
			}
		};

		expect(releaseCredentialProblems(workflow)).toContain(
			'bump job does not mint a token with a sha-pinned actions/create-github-app-token'
		);
	});

	it('rejects a token that skips revocation or widens repository access', () => {
		const workflow: Workflow = {
			jobs: {
				bump: {
					steps: [
						{
							...appTokenStep,
							with: {
								...appTokenStep.with,
								'skip-token-revoke': 'true',
								repositories: '*'
							}
						},
						{
							uses: 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
							with: { ref: 'main', token: MINTED_TOKEN }
						}
					]
				}
			}
		};

		expect(releaseCredentialProblems(workflow)).toEqual([
			'installation token must be revoked when the job ends',
			'installation token must stay limited to this repository'
		]);
	});
});

describe('version-bump.yml', () => {
	const text = readFileSync(WORKFLOW_PATH, 'utf8');
	const workflow = load(text) as Workflow;

	it('does not reference the long-lived RELEASE_TOKEN secret', () => {
		expect(text).not.toContain('RELEASE_TOKEN');
	});

	it('checks out main with a short-lived GitHub App installation token', () => {
		expect(releaseCredentialProblems(workflow)).toEqual([]);
	});
});
