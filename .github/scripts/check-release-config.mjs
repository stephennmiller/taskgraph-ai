#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import { findRootDir } from './utils.mjs';

// The only registry publish is `npm stage publish` in version-bump.yml.
// npm's trusted publisher is pinned to that file (stage publish only), so a
// changesets release-candidate workflow cannot authenticate. This check reads
// committed config: workflow YAML, package.json scripts, and
// `.changeset/config.json`. It does not read `.changeset/pre.json`, which is
// changesets' runtime mode and not config.
const STAGED_PUBLISH_WORKFLOW = 'version-bump.yml';
// Releases stage under `next`; only this workflow, behind the npm-release
// environment's approval, moves a dist-tag such as `latest`.
const DIST_TAG_WORKFLOW = 'npm-dist-tag.yml';

// Command-shaped. A YAML comment is dropped by the parser, and `npm stage
// publish` does not match `npm publish`.
const CHANGESET_CMD = /(?:^|[\s;&|`(])(?:npx\s+)?changeset\b/;
const PUBLISH_PACKAGES_CMD = /(?:^|[\s;&|`(])publish-packages\b/;
const NPM_PUBLISH_CMD = /(?:^|[\s;&|`(])npm\s+publish\b/;
const NPM_STAGE_PUBLISH_CMD = /(?:^|[\s;&|`(])npm\s+stage\s+publish\b/;
const NEXT_TAG_STAGE_PUBLISH_CMD =
	/(?:^|[\s;&|`(])npm\s+stage\s+publish\b[^\n]*\s--tag[=\s]+next(?:\s|$)/m;
const NPM_DIST_TAG_CMD = /(?:^|[\s;&|`(])npm\s+dist-tags?\b/;

function jobRuns(job) {
	const steps = Array.isArray(job?.steps) ? job.steps : [];
	return steps
		.map((step) => step?.run)
		.filter((run) => typeof run === 'string')
		.join('\n');
}

// A job `permissions` block replaces the workflow block; GitHub does not merge
// them. `id-token: write` has to be on the block that actually applies.
function permissionsOf(job, workflow) {
	const perms = job?.permissions ?? workflow?.permissions;
	return perms && typeof perms === 'object' ? perms : {};
}

function hasIdTokenWrite(job, workflow) {
	return permissionsOf(job, workflow)['id-token'] === 'write';
}

function runsChangesetPath(text) {
	return CHANGESET_CMD.test(text) || PUBLISH_PACKAGES_CMD.test(text);
}

/**
 * @param {{
 *   workflows?: Record<string, unknown>,
 *   scripts?: Record<string, unknown>,
 *   hasChangesetConfig?: boolean
 * }} config
 * @returns {{ file: string, job?: string, message: string }[]}
 */
export function findReleaseConfigViolations(config) {
	const violations = [];
	const scripts =
		config?.scripts && typeof config.scripts === 'object' ? config.scripts : {};
	const workflows =
		config?.workflows && typeof config.workflows === 'object'
			? config.workflows
			: {};

	if (Object.hasOwn(scripts, 'publish-packages')) {
		violations.push({
			file: 'package.json',
			message:
				'script "publish-packages" is retired; npm releases are staged by version-bump.yml'
		});
	}

	for (const [name, body] of Object.entries(scripts)) {
		if (name === 'publish-packages' || typeof body !== 'string') continue;
		if (runsChangesetPath(body)) {
			violations.push({
				file: 'package.json',
				message: `script "${name}" invokes changesets, which is no longer a release path`
			});
		} else if (NPM_PUBLISH_CMD.test(body)) {
			violations.push({
				file: 'package.json',
				message: `script "${name}" runs npm publish; releases are staged by version-bump.yml`
			});
		}
	}

	if (config?.hasChangesetConfig) {
		violations.push({
			file: '.changeset/config.json',
			message:
				'changesets config is a second release system; version-bump.yml bumps from conventional commits'
		});
	}

	let staged = false;
	for (const [file, workflow] of Object.entries(workflows)) {
		const jobs = workflow?.jobs;
		if (!jobs || typeof jobs !== 'object') continue;
		for (const [jobId, job] of Object.entries(jobs)) {
			const text = jobRuns(job);
			const where = { file, job: jobId };
			if (runsChangesetPath(text)) {
				violations.push({
					...where,
					message: 'runs the retired changesets release path'
				});
			}
			if (NPM_PUBLISH_CMD.test(text)) {
				violations.push({
					...where,
					message:
						'runs npm publish; the trusted publisher only allows npm stage publish from version-bump.yml'
				});
			}
			if (NPM_DIST_TAG_CMD.test(text)) {
				if (file !== DIST_TAG_WORKFLOW) {
					violations.push({
						...where,
						message: `runs npm dist-tag outside ${DIST_TAG_WORKFLOW}, the only workflow that may move latest`
					});
				} else if (!job?.environment || !hasIdTokenWrite(job, workflow)) {
					violations.push({
						...where,
						message:
							'npm dist-tag must run in an approval environment with id-token: write, not an npm token'
					});
				}
			}
			if (!NPM_STAGE_PUBLISH_CMD.test(text)) continue;
			if (file !== STAGED_PUBLISH_WORKFLOW) {
				violations.push({
					...where,
					message:
						'runs npm stage publish outside version-bump.yml, the only workflow the trusted publisher names'
				});
				continue;
			}
			staged = true;
			if (!NEXT_TAG_STAGE_PUBLISH_CMD.test(text)) {
				violations.push({
					...where,
					message: `npm stage publish must use --tag next; ${DIST_TAG_WORKFLOW} promotes it to latest`
				});
			}
			if (!hasIdTokenWrite(job, workflow)) {
				violations.push({
					...where,
					message:
						'npm stage publish must authenticate with id-token: write, not an npm token'
				});
			}
		}
	}

	if (!staged) {
		violations.push({
			file: STAGED_PUBLISH_WORKFLOW,
			message: 'must run `npm stage publish` (the only npm publish path)'
		});
	}

	return violations;
}

export function loadReleaseConfig(rootDir) {
	const workflowDir = join(rootDir, '.github', 'workflows');
	const workflows = {};
	if (existsSync(workflowDir)) {
		for (const name of readdirSync(workflowDir)
			.filter((entry) => /\.ya?ml$/.test(entry))
			.sort()) {
			workflows[name] = load(readFileSync(join(workflowDir, name), 'utf8'));
		}
	}

	let scripts = {};
	const pkgPath = join(rootDir, 'package.json');
	if (existsSync(pkgPath)) {
		const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
		scripts = pkg.scripts ?? {};
	}

	return {
		workflows,
		scripts,
		hasChangesetConfig: existsSync(join(rootDir, '.changeset', 'config.json'))
	};
}

function main() {
	const rootDir = process.argv[2]
		? resolve(process.argv[2])
		: findRootDir(dirname(fileURLToPath(import.meta.url)));
	const violations = findReleaseConfigViolations(loadReleaseConfig(rootDir));

	for (const violation of violations) {
		const where = violation.job
			? `${violation.file} job "${violation.job}"`
			: violation.file;
		console.error(
			`::error file=${violation.file}::${where}: ${violation.message}`
		);
	}

	if (violations.length > 0) {
		console.error(`${violations.length} release-config violation(s).`);
		process.exit(1);
	}
	console.log(
		'Release config stages npm under next from version-bump.yml and moves latest only from npm-dist-tag.yml.'
	);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	main();
}
