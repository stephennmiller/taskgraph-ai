/**
 * MCP tools take file paths from the model. They must stay inside projectRoot,
 * or a tool call can read or overwrite any file the user can.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parsePRDDirect } from '../../../../mcp-server/src/core/direct-functions/parse-prd.js';
import { researchDirect } from '../../../../mcp-server/src/core/direct-functions/research.js';
import {
	assertInsideRoot,
	resolvePrdPath,
	resolveTasksPath
} from '../../../../mcp-server/src/core/utils/path-utils.js';

let root;
let outside;

beforeEach(() => {
	const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tg-')));
	root = path.join(base, 'project');
	outside = path.join(base, 'secrets');
	fs.mkdirSync(root);
	fs.mkdirSync(outside);
});

afterEach(() =>
	fs.rmSync(path.dirname(root), { recursive: true, force: true })
);

describe('assertInsideRoot', () => {
	test('resolves a relative path against the root', () => {
		expect(assertInsideRoot(root, 'docs/prd.md')).toBe(
			path.join(root, 'docs/prd.md')
		);
	});

	test('accepts an absolute path inside the root', () => {
		const inside = path.join(root, 'a.json');
		expect(assertInsideRoot(root, inside)).toBe(inside);
	});

	test.each([
		['../secrets/x.json'],
		['docs/../../secrets/x.json'],
		['~/.ssh/config']
	])('refuses %s', (p) => {
		expect(() => assertInsideRoot(root, p)).toThrow(/outside the project/);
	});

	test('refuses an absolute path outside the root', () => {
		expect(() => assertInsideRoot(root, path.join(outside, 'x'))).toThrow(
			/outside the project/
		);
	});

	test('refuses a symlink that points outside the root', () => {
		fs.symlinkSync(outside, path.join(root, 'link'));
		expect(() => assertInsideRoot(root, 'link/x.json')).toThrow(
			/outside the project/
		);
	});
});

describe('tool path resolvers', () => {
	test('an absolute path without a projectRoot is refused, not trusted', () => {
		expect(() => resolveTasksPath({ file: '/etc/passwd' })).toThrow(
			/projectRoot is required/
		);
		expect(() => resolvePrdPath({ input: '/etc/passwd' })).toThrow(
			/projectRoot is required/
		);
	});

	test('resolveTasksPath refuses a file outside projectRoot', () => {
		expect(() =>
			resolveTasksPath({
				projectRoot: root,
				file: path.join(outside, 't.json')
			})
		).toThrow(/outside the project/);
	});

	test('resolvePrdPath refuses an input outside projectRoot', () => {
		expect(() =>
			resolvePrdPath({ projectRoot: root, input: '../secrets/.env' })
		).toThrow(/outside the project/);
	});
});

describe('parsePRDDirect output', () => {
	test('refuses an output file outside projectRoot before doing any work', async () => {
		const input = path.join(root, 'prd.md');
		fs.writeFileSync(input, 'prd');
		const target = path.join(outside, 'tasks.json');

		const result = await parsePRDDirect(
			{ projectRoot: root, input, output: target },
			{ info() {}, error() {}, warn() {}, debug() {} }
		);

		expect(result.success).toBe(false);
		expect(result.error.code).toBe('INVALID_PATH');
		expect(fs.existsSync(target)).toBe(false);
	});
});

describe('researchDirect filePaths', () => {
	test('refuses a context file outside projectRoot before any AI call', async () => {
		const secret = path.join(outside, 'id_rsa');
		fs.writeFileSync(secret, 'PRIVATE');

		const result = await researchDirect(
			{ query: 'q', projectRoot: root, filePaths: `src/a.js,${secret}` },
			{ info() {}, error() {}, warn() {}, debug() {} }
		);

		expect(result.success).toBe(false);
		expect(result.error.code).toBe('INVALID_PATH');
	});
});

describe('assertInsideRoot with a root that does not exist yet', () => {
	test('judges the path instead of throwing ENOENT', () => {
		const missing = path.join(outside, 'new-project');
		expect(assertInsideRoot(missing, 'a.json')).toBe(
			path.join(missing, 'a.json')
		);
		expect(() => assertInsideRoot(missing, '../x')).toThrow(
			/outside the project/
		);
	});
});
