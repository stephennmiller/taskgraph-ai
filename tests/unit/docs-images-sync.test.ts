import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The Mintlify site can only serve files under apps/docs, so it keeps copies
// of the README graphics; this catches a re-render that updates only one side.
const root = join(import.meta.dirname, '../..');
const docsImages = join(root, 'apps/docs/images');
const copies = [
	'how-it-works.svg',
	'how-it-works-dark.svg',
	...readdirSync(join(docsImages, 'demo')).map((f) => `demo/${f}`)
];

describe('docs site graphics', () => {
	it.each(copies)('%s matches images/', (file) => {
		expect(readFileSync(join(docsImages, file), 'utf8')).toBe(
			readFileSync(join(root, 'images', file), 'utf8')
		);
	});

	it('copies every demo clip', () => {
		const svgs = (dir: string) =>
			readdirSync(dir).filter((f) => f.endsWith('.svg'));
		expect(svgs(join(docsImages, 'demo'))).toEqual(
			svgs(join(root, 'images/demo'))
		);
	});
});
