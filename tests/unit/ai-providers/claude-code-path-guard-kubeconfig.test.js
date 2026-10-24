/**
 * Kubeconfigs kept outside .kube under the names tools write them as (#396,
 * #438). Read, Glob and Grep refuse them, and a directory-wide Grep skips
 * them, while files that only contain the word stay readable.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
	excludeSecretsFromGrep,
	getPathViolation
} from '../../../src/ai-providers/claude-code-path-guard.js';
import { ripgrep, runGrep } from './claude-code-ripgrep.js';

describe('claude-code path guard: kubeconfig names (#438)', () => {
	let project;

	const secrets = [
		'kubeconfig',
		'kubeconfig.yaml',
		'deploy/kubeconfig.yml',
		'KUBECONFIG.YAML',
		'kubeconfig-prod',
		'deploy/Kubeconfig-Staging.yaml',
		'terraform/kubeconfig_prod',
		'kind-kubeconfig',
		'clusters/prod_kubeconfig',
		'KIND-KUBECONFIG',
		'deploy/prod.kubeconfig',
		// A directory named kubeconfig is skipped whole, see below
		'pkg/kubeconfig/kubeconfig.go'
	];
	const others = [
		'src/kubeconfig.ts',
		'docs/kubeconfig.md',
		'src/kubeconfig.yaml.ts',
		'src/kubeconfigLoader.ts',
		'docs/kubeconfigs.md',
		'src/my-kubeconfig-loader.ts',
		'src/kind-kubeconfig.ts'
	];

	beforeAll(() => {
		project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tm-kc-')));
		for (const file of [...secrets, ...others]) {
			fs.mkdirSync(path.dirname(path.join(project, file)), {
				recursive: true
			});
			fs.writeFileSync(path.join(project, file), `API_KEY=${file}\n`);
		}
	});

	afterAll(() => fs.rmSync(project, { recursive: true, force: true }));

	it.each(secrets)('denies Read, Glob and Grep of %s', (file) => {
		const glob = `**/${file}`;
		expect(getPathViolation(project, 'Read', { file_path: file })).toMatch(
			/secret/
		);
		expect(getPathViolation(project, 'Glob', { pattern: glob })).toMatch(
			/secret/
		);
		expect(
			getPathViolation(project, 'Grep', { pattern: 'x', path: file })
		).toMatch(/secret/);
		expect(getPathViolation(project, 'Grep', { pattern: 'x', glob })).toMatch(
			/secret/
		);
	});

	it.each([
		'**/kubeconfig-*',
		'**/kubeconfig_*',
		'**/*-kubeconfig',
		'*_kubeconfig'
	])('denies Glob pattern and Grep glob %s', (glob) => {
		expect(getPathViolation(project, 'Glob', { pattern: glob })).toMatch(
			/secret/
		);
		expect(getPathViolation(project, 'Grep', { pattern: 'x', glob })).toMatch(
			/secret/
		);
	});

	// The same case fold as the other names: Kelvin sign, dotless i
	it.each(['Kubeconfig', 'kind-Kubeconfig', 'prod_Kubeconfıg'])(
		'denies Read of case-fold look-alike %j',
		(file) => {
			expect(getPathViolation(project, 'Read', { file_path: file })).toMatch(
				/secret/
			);
		}
	);

	it.each(others)('allows Read of %s', (file) => {
		expect(getPathViolation(project, 'Read', { file_path: file })).toBeNull();
	});

	it
		.skipIf(!ripgrep)
		.each([
			[{ pattern: 'API_KEY' }],
			[{ pattern: 'API_KEY', glob: '*' }],
			[{ pattern: 'API_KEY', glob: '**/*' }]
		])('rewritten Grep %o skips exactly the secret files', (input) => {
		expect(runGrep(project, input)).toHaveLength(
			secrets.length + others.length
		);
		const lines = runGrep(project, excludeSecretsFromGrep(input));
		expect(lines).toEqual(
			others.map((file) => `./${file}:1:API_KEY=${file}`).sort()
		);
	});

	// rg globs can't match files only, so `!kubeconfig` skips a directory of
	// that name too. Read refuses one as well, so the two agree. To let such
	// directories through, change these tests together with isSecretName and
	// the SECRET_GLOBS built from it.
	describe('a directory named kubeconfig', () => {
		it.each([
			['Read', { file_path: 'pkg/kubeconfig/kubeconfig.go' }],
			['Read', { file_path: 'pkg/kubeconfig/' }],
			['Grep', { pattern: 'x', path: 'pkg/kubeconfig' }],
			['Grep', { pattern: 'x', glob: 'pkg/kubeconfig/*.go' }],
			['Glob', { pattern: 'pkg/kubeconfig/**' }]
		])('is refused on %s %o', (tool, input) => {
			expect(getPathViolation(project, tool, input)).toMatch(/secret/);
		});

		it.skipIf(!ripgrep)('is skipped by a rewritten Grep', () => {
			const input = { pattern: 'API_KEY', path: 'pkg' };
			const line = 'pkg/kubeconfig/kubeconfig.go:1:';
			expect(runGrep(project, input).join('\n')).toContain(line);
			expect(
				runGrep(project, excludeSecretsFromGrep(input)).join('\n')
			).not.toContain(line);
		});
	});
});
