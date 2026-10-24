/**
 * @fileoverview A project for the tasks.parsePrd tests: a temp folder with
 * config, tasks.json and a PRD, and the AI service mocked
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { vi } from 'vitest';
import { AiService } from '../../../src/modules/ai/ai-service.js';
import { archivePathFor } from '../../../src/modules/tasks/utils/archive.js';
import { type TmCore, createTmCore } from '../../../src/tm-core.js';

/** The PRD the legacy prompt inputs were captured from, and its next version */
export const PRD_V1 =
	'# Bookmarks\n\nSave links for later.\n\n## Sign-in\n\nEmail and password.\n\n## Saving links\n\nSave a URL with tags.\n';
export const PRD_V2 = `${PRD_V1}\n## Export\n\nExport bookmarks as JSON.\n`;

export const existing = (id: number | string, title: string, extra = {}) => ({
	id,
	title,
	description: `${title}, described`,
	status: 'pending',
	dependencies: [] as Array<number | string>,
	priority: 'medium',
	details: 'd',
	testStrategy: 't',
	subtasks: [],
	...extra
});

export const EXISTING = [
	existing(1, 'Set up the repo'),
	existing(2, 'Add sign-in', { dependencies: [1], status: 'done' })
];

/** A task as the model writes it */
export const generated = (id: number, extra = {}) => ({
	id,
	title: `New ${id}`,
	description: 'Do it',
	details: '',
	testStrategy: '',
	priority: 'high',
	dependencies: [] as number[],
	status: 'pending',
	section: null as string | null,
	...extra
});

export const reply = (tasks: object[] = [generated(1)]) => ({
	mainResult: { tasks },
	telemetryData: { userId: 'u', inputTokens: 10, outputTokens: 5 },
	tagInfo: { currentTag: 'master', availableTags: ['master'] },
	providerName: 'claude-code',
	modelId: 'sonnet'
});

export interface PrdProject {
	root: string;
	tasksPath: string;
	prdPath: string;
	tmCore: TmCore;
	generateObject: ReturnType<typeof vi.spyOn>;
	streamObject: ReturnType<typeof vi.spyOn>;
	read: () => any;
	write: (data: unknown) => void;
	archive: (tag: string, highestId: number) => void;
	close: () => Promise<void>;
}

export async function createPrdProject(
	options: { analysis?: boolean; global?: object; models?: object } = {}
): Promise<PrdProject> {
	const root = fs.realpathSync(
		fs.mkdtempSync(path.join(os.tmpdir(), 'tm-parse-prd-'))
	);
	const tg = path.join(root, '.taskgraph');
	fs.mkdirSync(path.join(tg, 'tasks'), { recursive: true });
	fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
	fs.writeFileSync(
		path.join(tg, 'config.json'),
		JSON.stringify({
			models: options.models ?? {},
			global: {
				enableCodebaseAnalysis: options.analysis ?? true,
				...options.global
			}
		})
	);
	const tasksPath = path.join(tg, 'tasks', 'tasks.json');
	const prdPath = path.join(root, 'docs', 'prd.md');
	fs.writeFileSync(prdPath, PRD_V1);
	const write = (data: unknown) =>
		fs.writeFileSync(tasksPath, JSON.stringify(data));
	write({ master: { tasks: [], metadata: {} } });
	const generateObject = vi
		.spyOn(AiService.prototype, 'generateObject')
		.mockResolvedValue(reply() as any);
	const streamObject = vi.spyOn(AiService.prototype, 'streamObject');
	const tmCore = await createTmCore({ projectPath: root });
	return {
		root,
		tasksPath,
		prdPath,
		tmCore,
		generateObject,
		streamObject,
		read: () => JSON.parse(fs.readFileSync(tasksPath, 'utf8')),
		write,
		archive: (tag, highestId) =>
			fs.writeFileSync(
				archivePathFor(tasksPath),
				JSON.stringify({
					[tag]: {
						tasks: [existing(highestId, 'Old', { status: 'done' })],
						metadata: { highestId }
					}
				})
			),
		close: async () => {
			vi.restoreAllMocks();
			await tmCore.close();
			fs.rmSync(root, { recursive: true, force: true });
		}
	};
}
