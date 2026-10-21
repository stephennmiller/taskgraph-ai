import { describe, expect, it, vi } from 'vitest';
import { withNormalizedProjectRoot } from './utils.js';

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
