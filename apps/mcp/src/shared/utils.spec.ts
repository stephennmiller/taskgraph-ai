import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	resolveInsideRoot,
	withNormalizedProjectRoot,
	withToolContext
} from './utils.js';

vi.mock('@tm/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tm/core')>()),
	createTmCore: vi.fn(async () => ({}))
}));

describe('withNormalizedProjectRoot tag check', () => {
	const run = (tag: unknown) => {
		const fn = vi.fn().mockResolvedValue({ content: [] });
		const result = withNormalizedProjectRoot(fn)(
			{ projectRoot: '/tmp/project', tag } as never,
			{ log: {} }
		);
		return { fn, result };
	};

	it.each(['../../etc/x', 'a/b', 'a b', '', 'x;rm', 5])(
		'refuses tag %j before calling the tool',
		async (tag) => {
			const { fn, result } = run(tag);
			expect((await result).isError).toBe(true);
			expect(fn).not.toHaveBeenCalled();
		}
	);

	it.each(['master', 'feature-1', 'v2_beta', undefined])(
		'lets tag %j through',
		async (tag) => {
			const { fn, result } = run(tag);
			await result;
			expect(fn).toHaveBeenCalledOnce();
		}
	);
});

describe('withNormalizedProjectRoot project root (#339)', () => {
	const main = path.resolve('/projects/main');
	const other = path.resolve('/projects/other');

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	const rootPassed = async (args: object, context: object = {}) => {
		const fn = vi.fn().mockResolvedValue({ content: [] });
		await withNormalizedProjectRoot(fn)(args as never, { log: {}, ...context });
		return fn.mock.calls[0]?.[0]?.projectRoot;
	};

	it('takes an explicit projectRoot over TASKGRAPH_PROJECT_ROOT', async () => {
		vi.stubEnv('TASKGRAPH_PROJECT_ROOT', main);

		expect(await rootPassed({ projectRoot: other })).toBe(other);
	});

	it("takes an explicit projectRoot over the session's TASKGRAPH_PROJECT_ROOT", async () => {
		vi.stubEnv('TASKGRAPH_PROJECT_ROOT', '');

		expect(
			await rootPassed(
				{ projectRoot: other },
				{ session: { env: { TASKGRAPH_PROJECT_ROOT: main } } }
			)
		).toBe(other);
	});

	it('keeps a loop --parallel task worktree on the main project', async () => {
		vi.stubEnv('TASKGRAPH_PROJECT_ROOT', main);
		const worktree = path.join(main, '.taskgraph', 'worktrees', 'task-3');

		expect(await rootPassed({ projectRoot: worktree })).toBe(main);
	});

	it('uses TASKGRAPH_PROJECT_ROOT when no projectRoot is passed', async () => {
		vi.stubEnv('TASKGRAPH_PROJECT_ROOT', main);

		expect(
			await rootPassed({}, { session: { roots: [{ uri: `file://${other}` }] } })
		).toBe(main);
	});

	it("uses the session's TASKGRAPH_PROJECT_ROOT when the process has none", async () => {
		vi.stubEnv('TASKGRAPH_PROJECT_ROOT', '');

		expect(
			await rootPassed(
				{},
				{ session: { env: { TASKGRAPH_PROJECT_ROOT: main } } }
			)
		).toBe(main);
	});

	it("falls back to the session's root folder", async () => {
		vi.stubEnv('TASKGRAPH_PROJECT_ROOT', '');

		expect(
			await rootPassed({}, { session: { roots: [{ uri: `file://${other}` }] } })
		).toBe(other);
	});
});

describe('withToolContext project .env', () => {
	it("does not load the project's .env into process.env", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-env-'));
		fs.writeFileSync(path.join(root, '.env'), 'TM_LEAK_CHECK=from-project\n');
		const fn = vi.fn().mockResolvedValue({ content: [] });

		await withToolContext(fn)(
			{ projectRoot: root } as never,
			{ log: {} } as never
		);

		expect(fn).toHaveBeenCalledOnce();
		expect(process.env.TM_LEAK_CHECK).toBeUndefined();
	});
});

describe('resolveInsideRoot', () => {
	const root = fs.realpathSync(
		fs.mkdtempSync(path.join(os.tmpdir(), 'tm-inside-root-'))
	);
	const outside = fs.realpathSync(
		fs.mkdtempSync(path.join(os.tmpdir(), 'tm-outside-root-'))
	);
	fs.mkdirSync(path.join(root, 'docs'));
	fs.symlinkSync(outside, path.join(root, 'escape'));

	it('resolves relative and absolute paths inside the root', () => {
		expect(resolveInsideRoot(root, 'docs/new/dir')).toBe(
			path.join(root, 'docs', 'new', 'dir')
		);
		expect(resolveInsideRoot(root, path.join(root, 'docs'))).toBe(
			path.join(root, 'docs')
		);
		expect(resolveInsideRoot(root, 'docs/../out')).toBe(path.join(root, 'out'));
	});

	it.each([
		['../sibling'],
		['docs/../../sibling'],
		['/etc'],
		['~/tasks'],
		['escape'],
		['escape/new/dir']
	])('refuses %s', (candidate) => {
		expect(() => resolveInsideRoot(root, candidate)).toThrow(
			`Path '${candidate}' is outside the project root '${root}'`
		);
	});

	it('throws when the project root does not exist', () => {
		expect(() =>
			resolveInsideRoot(path.join(root, 'missing'), 'docs')
		).toThrow();
	});
});
