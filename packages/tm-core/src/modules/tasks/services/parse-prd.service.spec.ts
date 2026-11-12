/**
 * @fileoverview Which PRD parse-prd reads: only a file inside the project
 * that isn't a secret, with the same not-found messages as before
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	PRD_SNAPSHOT_KEY,
	buildPrdSnapshot,
	trackedPrdSections,
	withPrdSnapshot
} from '../../prd/prd-deltas.js';
import { parsePrdSections } from '../../prd/prd-sections.js';
import { ParsePrdService } from './parse-prd.service.js';

let base: string;
let root: string;
let docs: string;
let service: ParsePrdService;

beforeEach(() => {
	base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'prd-')));
	root = path.join(base, 'project');
	docs = path.join(root, '.taskgraph', 'docs');
	fs.mkdirSync(docs, { recursive: true });
	fs.writeFileSync(path.join(root, '.env'), 'TOKEN=1');
	fs.writeFileSync(path.join(base, 'outside.md'), '# Outside');
	service = new ParsePrdService(
		{} as any,
		{
			getProjectRoot: () => root
		} as any
	);
});

afterEach(() => {
	fs.rmSync(base, { recursive: true, force: true });
});

describe('resolvePrdPath', () => {
	it('returns the named PRD under the project root, and the first default otherwise', () => {
		fs.writeFileSync(path.join(root, 'spec.md'), '# Spec');
		fs.writeFileSync(path.join(docs, 'PRD.md'), '# PRD');

		expect(service.resolvePrdPath('spec.md')).toBe(path.join(root, 'spec.md'));
		expect(service.resolvePrdPath()).toBe(path.join(docs, 'PRD.md'));
	});

	it('keeps the not-found messages', () => {
		expect(() => service.resolvePrdPath('missing.md')).toThrow(
			'missing.md not found'
		);
		expect(() => service.resolvePrdPath()).toThrow(
			'Required PRD file not found. Searched: .taskgraph/docs/PRD.md, .taskgraph/docs/prd.md, .taskgraph/docs/PRD.txt, .taskgraph/docs/prd.txt'
		);
	});

	it('refuses a named PRD outside the project, relative or absolute', () => {
		expect(() => service.resolvePrdPath('../outside.md')).toThrow(
			'outside the project'
		);
		expect(() => service.resolvePrdPath(path.join(base, 'outside.md'))).toThrow(
			'outside the project'
		);
	});

	it('refuses a named PRD that is a secret file', () => {
		expect(() => service.resolvePrdPath('.env')).toThrow('secret file');
	});

	it('refuses a default PRD that is a link to .env instead of skipping it', () => {
		fs.symlinkSync(path.join(root, '.env'), path.join(docs, 'PRD.md'));
		// not prd.md: on a case-insensitive filesystem that is PRD.md, and the write goes through the link
		fs.writeFileSync(path.join(docs, 'PRD.txt'), '# PRD');

		expect(() => service.resolvePrdPath()).toThrow('secret file');
		expect(fs.readFileSync(path.join(root, '.env'), 'utf8')).toBe('TOKEN=1');
	});

	it('refuses a named PRD that links out of the project', () => {
		fs.symlinkSync(path.join(base, 'outside.md'), path.join(root, 'prd.md'));

		expect(() => service.resolvePrdPath('prd.md')).toThrow();
	});
	it('resolves a PRD through a project root that is a link, as the path given', () => {
		// macOS /tmp is a link: tasks cite the PRD under the root as configured
		const link = path.join(base, 'project-link');
		fs.symlinkSync(root, link);
		fs.writeFileSync(path.join(root, 'spec.md'), '# Spec');
		fs.writeFileSync(path.join(docs, 'PRD.md'), '# PRD');
		const linked = new ParsePrdService(
			{} as any,
			{ getProjectRoot: () => link } as any
		);

		expect(linked.resolvePrdPath('spec.md')).toBe(path.join(link, 'spec.md'));
		expect(linked.resolvePrdPath()).toBe(
			path.join(link, '.taskgraph', 'docs', 'PRD.md')
		);
	});
});

describe('hasNewSections (#1146)', () => {
	const PRD = '# App\n\n## Notes\n\nCreate notes.\n';
	/** A tag that recorded `recorded` as the PRD it was last parsed from */
	const withTag = (recorded: string) => {
		const sections = parsePrdSections(recorded);
		const metadata = {
			[PRD_SNAPSHOT_KEY]: withPrdSnapshot(
				null,
				'spec.md',
				buildPrdSnapshot(trackedPrdSections(sections, recorded))
			)
		};
		fs.mkdirSync(path.join(root, '.taskgraph', 'tasks'), { recursive: true });
		fs.writeFileSync(
			path.join(root, '.taskgraph', 'tasks', 'tasks.json'),
			JSON.stringify({ master: { tasks: [], metadata } })
		);
		return new ParsePrdService(
			{
				initialize: async () => {},
				getStorage: () => ({
					getAllTags: async () => ['master'],
					loadTasks: async () => [],
					loadMetadata: async () => metadata
				})
			} as any,
			{ getProjectRoot: () => root, getActiveTag: () => 'master' } as any
		);
	};

	beforeEach(() => {
		fs.writeFileSync(path.join(root, 'spec.md'), PRD);
	});

	it('is true for a PRD the tag knows nothing of: all of it is new', async () => {
		const fresh = new ParsePrdService(
			{} as any,
			{ getProjectRoot: () => root, getActiveTag: () => 'master' } as any
		);

		expect(await fresh.hasNewSections({ prdPath: 'spec.md' })).toBe(true);
	});

	it('is false when every section was recorded: an append adds nothing', async () => {
		expect(await withTag(PRD).hasNewSections({ prdPath: 'spec.md' })).toBe(
			false
		);
	});

	it('is true once the PRD gains a section', async () => {
		const service = withTag(PRD);
		fs.writeFileSync(
			path.join(root, 'spec.md'),
			`${PRD}\n## Tags\n\nTag notes.\n`
		);

		expect(await service.hasNewSections({ prdPath: 'spec.md' })).toBe(true);
	});
});
