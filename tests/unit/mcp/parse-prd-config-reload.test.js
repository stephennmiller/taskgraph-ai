/**
 * The MCP models and response-language tools save through @tm/core, which
 * doesn't touch the legacy config-manager cache. parse_prd runs in the same
 * long-lived server process, so it must read the saved settings, not the
 * ones it cached on an earlier call.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createTmCore } from '@tm/core';
import { parsePRDDirect } from '../../../mcp-server/src/core/direct-functions/parse-prd.js';
import {
	getMainModelId,
	getResponseLanguage
} from '../../../scripts/modules/config-manager.js';
import { parsePRD } from '../../../scripts/modules/task-manager.js';

vi.mock('../../../scripts/modules/task-manager.js', () => ({
	parsePRD: vi.fn()
}));

const log = { info() {}, warn() {}, error() {}, debug() {}, success() {} };
let root;

beforeEach(() => {
	root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tg-')));
	fs.mkdirSync(path.join(root, '.taskgraph'));
	fs.writeFileSync(
		path.join(root, '.taskgraph', 'config.json'),
		JSON.stringify({
			models: { main: { provider: 'claude-code', modelId: 'sonnet' } }
		})
	);
	fs.writeFileSync(path.join(root, 'prd.md'), '# PRD\n');
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

test('parse_prd uses the model and language saved since its last call', async () => {
	let seen;
	vi.mocked(parsePRD).mockImplementation(async () => {
		seen = [getMainModelId(root), getResponseLanguage(root)];
		return { success: false };
	});
	await parsePRDDirect({ projectRoot: root, input: 'prd.md' }, log);
	expect(seen).toEqual(['sonnet', 'English']);

	const { config } = await createTmCore({ projectPath: root });
	config.setModel('main', 'opus');
	config.setResponseLanguage('French');
	await parsePRDDirect({ projectRoot: root, input: 'prd.md' }, log);

	expect(seen).toEqual(['opus', 'French']);
});
