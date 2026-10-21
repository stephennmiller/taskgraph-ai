import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { withNormalizedProjectRoot, withToolContext } from './utils.js';

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
