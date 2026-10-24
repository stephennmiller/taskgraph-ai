/**
 * parse-prd's overwrite prompt without a terminal fails instead of waiting
 * for an answer that never comes (#481)
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { confirmTaskOverwrite } from '../../../../../scripts/modules/ui/complexity.js';

describe('confirmTaskOverwrite', () => {
	const isTTY = process.stdin.isTTY;

	afterEach(() => {
		process.stdin.isTTY = isTTY;
		vi.restoreAllMocks();
	});

	it('exits 1 naming --append and --force when stdin is not a terminal', async () => {
		process.stdin.isTTY = false;
		vi.spyOn(console, 'log').mockImplementation(() => {});
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(process, 'exit').mockImplementation((code) => {
			throw new Error(`exit ${code}`);
		});

		await expect(confirmTaskOverwrite('tasks.json')).rejects.toThrow('exit 1');

		const printed = error.mock.calls.flat().join('\n');
		expect(printed).toContain('--append');
		expect(printed).toContain('--force');
	});
});
