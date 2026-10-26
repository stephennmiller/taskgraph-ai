import { readFileSync } from 'node:fs';
import path from 'node:path';
import { biomeFormattedJson } from '../../../evals/lib/baseline.js';

const repoRoot = path.resolve(__dirname, '../../..');
const baselinePath = path.join(repoRoot, 'evals', 'baseline.json');

describe('biomeFormattedJson (#724)', () => {
	it('collapses short arrays the way the Format Check expects', () => {
		const json = biomeFormattedJson({ tags: ['Goal'] }, repoRoot, baselinePath);

		expect(json).toBe('{\n\t"tags": ["Goal"]\n}\n');
	});

	it('rewrites the committed baseline unchanged', () => {
		const committed = readFileSync(baselinePath, 'utf8');

		const json = biomeFormattedJson(
			JSON.parse(committed),
			repoRoot,
			baselinePath
		);

		expect(json).toBe(committed);
	});
});
