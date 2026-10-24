import fs from 'fs';
import os from 'os';
import path from 'path';
import { getAssetsDir } from '../../src/utils/asset-resolver.js';

describe('asset resolver', () => {
	it('locates the assets directory by the Claude AGENTS.md guide', () => {
		const dir = getAssetsDir();

		expect(fs.existsSync(path.join(dir, 'AGENTS.md'))).toBe(true);
	});

	it('finds the repo assets from source when run in another directory', () => {
		// scripts/dev.js init in a fresh project (as npm run evals does)
		const cwd = vi.spyOn(process, 'cwd').mockReturnValue(os.tmpdir());
		try {
			expect(getAssetsDir()).toBe(
				path.resolve(import.meta.dirname, '..', '..', 'assets')
			);
		} finally {
			cwd.mockRestore();
		}
	});

	it.each(['rules', 'roocode', 'kiro-hooks', 'GEMINI.md'])(
		'ships no non-Claude asset "%s"',
		(name) => {
			expect(fs.existsSync(path.join(getAssetsDir(), name))).toBe(false);
		}
	);
});
