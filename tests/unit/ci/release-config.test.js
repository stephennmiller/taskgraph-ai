import { spawnSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	findReleaseConfigViolations,
	loadReleaseConfig
} from '../../../.github/scripts/check-release-config.mjs';

const rootDir = fileURLToPath(new URL('../../..', import.meta.url));
const script = join(rootDir, '.github/scripts/check-release-config.mjs');

const stageWorkflow = (permissions) => ({
	permissions,
	jobs: {
		publish: {
			...(permissions ? {} : { permissions: { contents: 'read' } }),
			steps: [{ run: 'npm stage publish' }]
		}
	}
});

const oidcStageWorkflow = () => ({
	jobs: {
		publish: {
			permissions: { contents: 'read', 'id-token': 'write' },
			steps: [{ run: 'npm stage publish' }]
		}
	}
});

const cleanConfig = (overrides = {}) => ({
	workflows: { 'version-bump.yml': oidcStageWorkflow() },
	scripts: { test: 'vitest run' },
	hasChangesetConfig: false,
	...overrides
});

describe('findReleaseConfigViolations', () => {
	it('accepts staged publish from version-bump.yml with id-token write', () => {
		expect(findReleaseConfigViolations(cleanConfig())).toEqual([]);
	});

	it('accepts id-token write inherited from the workflow when the job sets none', () => {
		const config = cleanConfig({
			workflows: {
				'version-bump.yml': stageWorkflow({ 'id-token': 'write' })
			}
		});
		expect(findReleaseConfigViolations(config)).toEqual([]);
	});

	it('rejects a job permissions block that drops id-token inherited from the workflow', () => {
		const config = cleanConfig({
			workflows: {
				'version-bump.yml': {
					permissions: { 'id-token': 'write' },
					jobs: {
						publish: {
							permissions: { contents: 'read' },
							steps: [{ run: 'npm stage publish' }]
						}
					}
				}
			}
		});
		expect(findReleaseConfigViolations(config)).toEqual([
			{
				file: 'version-bump.yml',
				job: 'publish',
				message:
					'npm stage publish must authenticate with id-token: write, not an npm token'
			}
		]);
	});

	it('rejects the publish-packages script', () => {
		const config = cleanConfig({
			scripts: {
				'publish-packages':
					'turbo run build lint test && changeset version && changeset publish'
			}
		});
		expect(findReleaseConfigViolations(config)).toEqual([
			{
				file: 'package.json',
				message:
					'script "publish-packages" is retired; npm releases are staged by version-bump.yml'
			}
		]);
	});

	it('rejects a changeset script without reporting publish-packages twice', () => {
		const config = cleanConfig({
			scripts: {
				changeset: 'changeset',
				'publish-packages': 'changeset publish'
			}
		});
		expect(findReleaseConfigViolations(config)).toEqual([
			{
				file: 'package.json',
				message:
					'script "publish-packages" is retired; npm releases are staged by version-bump.yml'
			},
			{
				file: 'package.json',
				message:
					'script "changeset" invokes changesets, which is no longer a release path'
			}
		]);
	});

	it('rejects changeset pre, version, and publish in a workflow run step', () => {
		const config = cleanConfig({
			workflows: {
				'version-bump.yml': oidcStageWorkflow(),
				'release.yml': {
					jobs: {
						rc: {
							permissions: { 'id-token': 'write' },
							steps: [
								{
									run: 'npx changeset pre enter rc\nnpx changeset version\nnpx changeset publish\n'
								}
							]
						}
					}
				}
			}
		});
		expect(findReleaseConfigViolations(config)).toEqual([
			{
				file: 'release.yml',
				job: 'rc',
				message: 'runs the retired changesets release path'
			}
		]);
	});

	it('rejects npm publish, including inside version-bump.yml', () => {
		const config = cleanConfig({
			workflows: {
				'version-bump.yml': {
					jobs: {
						publish: {
							permissions: { 'id-token': 'write' },
							steps: [{ run: 'npm publish' }]
						}
					}
				}
			}
		});
		expect(findReleaseConfigViolations(config)).toEqual([
			{
				file: 'version-bump.yml',
				job: 'publish',
				message:
					'runs npm publish; the trusted publisher only allows npm stage publish from version-bump.yml'
			},
			{
				file: 'version-bump.yml',
				message: 'must run `npm stage publish` (the only npm publish path)'
			}
		]);
	});

	it('rejects npm stage publish outside version-bump.yml', () => {
		const config = cleanConfig({
			workflows: {
				'release.yml': {
					jobs: {
						rc: {
							permissions: { 'id-token': 'write' },
							steps: [{ run: 'npm stage publish' }]
						}
					}
				},
				'version-bump.yml': oidcStageWorkflow()
			}
		});
		expect(findReleaseConfigViolations(config)).toEqual([
			{
				file: 'release.yml',
				job: 'rc',
				message:
					'runs npm stage publish outside version-bump.yml, the only workflow the trusted publisher names'
			}
		]);
	});

	it('ignores id-token write on a job that does not publish', () => {
		const config = cleanConfig({
			workflows: {
				'version-bump.yml': oidcStageWorkflow(),
				'claude.yml': {
					jobs: {
						claude: {
							permissions: { 'id-token': 'write' },
							steps: [{ run: 'echo hello' }]
						}
					}
				}
			}
		});
		expect(findReleaseConfigViolations(config)).toEqual([]);
	});

	it('rejects changesets config as a second release system', () => {
		expect(
			findReleaseConfigViolations(cleanConfig({ hasChangesetConfig: true }))
		).toEqual([
			{
				file: '.changeset/config.json',
				message:
					'changesets config is a second release system; version-bump.yml bumps from conventional commits'
			}
		]);
	});

	it('does not throw on an empty workflow or a null job', () => {
		const config = cleanConfig();
		config.workflows['version-bump.yml'].jobs.empty = null;
		config.workflows['empty.yml'] = null;
		expect(findReleaseConfigViolations(config)).toEqual([]);
	});

	it('requires version-bump.yml to stage the release', () => {
		expect(
			findReleaseConfigViolations({
				workflows: {},
				scripts: {},
				hasChangesetConfig: false
			})
		).toEqual([
			{
				file: 'version-bump.yml',
				message: 'must run `npm stage publish` (the only npm publish path)'
			}
		]);
	});
});

describe('loadReleaseConfig', () => {
	let dir;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'release-config-'));
		mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
		writeFileSync(
			join(dir, 'package.json'),
			JSON.stringify({ name: 'fixture', scripts: { test: 'vitest' } })
		);
		writeFileSync(
			join(dir, '.github', 'workflows', 'version-bump.yml'),
			[
				'# leave "Allow npm publish" unchecked. Retired: npx changeset publish',
				'jobs:',
				'  publish:',
				'    permissions:',
				'      id-token: write',
				'    steps:',
				'      - run: npm stage publish',
				''
			].join('\n')
		);
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it('reads workflows and package.json and ignores pre.json mode', () => {
		mkdirSync(join(dir, '.changeset'));
		writeFileSync(
			join(dir, '.changeset', 'pre.json'),
			JSON.stringify({ mode: 'pre', tag: 'rc' })
		);

		expect(findReleaseConfigViolations(loadReleaseConfig(dir))).toEqual([]);
		expect(loadReleaseConfig(dir).hasChangesetConfig).toBe(false);
	});

	it('treats .changeset/config.json as a second release system', () => {
		mkdirSync(join(dir, '.changeset'));
		writeFileSync(join(dir, '.changeset', 'config.json'), '{}\n');
		writeFileSync(
			join(dir, '.changeset', 'pre.json'),
			JSON.stringify({ mode: 'pre', tag: 'rc' })
		);

		expect(findReleaseConfigViolations(loadReleaseConfig(dir))).toEqual([
			{
				file: '.changeset/config.json',
				message:
					'changesets config is a second release system; version-bump.yml bumps from conventional commits'
			}
		]);
	});
});

describe('this repo', () => {
	it('stages npm only from version-bump.yml', () => {
		expect(findReleaseConfigViolations(loadReleaseConfig(rootDir))).toEqual([]);
	});

	it('has no changesets release workflow or publish-packages script', () => {
		expect(existsSync(join(rootDir, '.github/workflows/release.yml'))).toBe(
			false
		);
		expect(existsSync(join(rootDir, '.changeset/config.json'))).toBe(false);
		const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'));
		expect(pkg.scripts['publish-packages']).toBeUndefined();
		expect(pkg.scripts.changeset).toBeUndefined();
		expect(pkg.devDependencies['@changesets/cli']).toBeUndefined();
		expect(pkg.devDependencies['@changesets/changelog-github']).toBeUndefined();
	});

	it('keeps the required check-release-mode job on the config check', () => {
		const workflow = readFileSync(
			join(rootDir, '.github/workflows/release-check.yml'),
			'utf8'
		);
		const install = workflow.indexOf('npm ci --ignore-scripts');
		const check = workflow.indexOf(
			'node ./.github/scripts/check-release-config.mjs'
		);
		expect(workflow).toContain('check-release-mode:');
		expect(workflow).not.toContain('check-pre-release-mode');
		expect(install).toBeGreaterThan(-1);
		expect(check).toBeGreaterThan(install);
	});

	it('the release check exits 0', () => {
		const result = spawnSync(process.execPath, [script, rootDir], {
			encoding: 'utf8'
		});
		expect(result.stderr).toBe('');
		expect(result.status).toBe(0);
	});
});
