import fs from 'fs';
import path from 'path';
import { getAssetsDir } from '../../src/utils/asset-resolver.js';

describe('asset resolver', () => {
	it('locates the assets directory by the Claude AGENTS.md guide', () => {
		const dir = getAssetsDir();

		expect(fs.existsSync(path.join(dir, 'AGENTS.md'))).toBe(true);
	});

	it.each(['rules', 'roocode', 'kiro-hooks', 'GEMINI.md'])(
		'ships no non-Claude asset "%s"',
		(name) => {
			expect(fs.existsSync(path.join(getAssetsDir(), name))).toBe(false);
		}
	);
});
