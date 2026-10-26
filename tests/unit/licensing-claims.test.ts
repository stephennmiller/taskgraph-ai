/**
 * Public licensing summaries must match LICENSE.
 *
 * MIT plus the Commons Clause withholds the right to Sell the software,
 * including hosting or support fees where the product's value derives
 * entirely or substantially from the software. It does not ban competing
 * products, and it does not ban hosting outright. Issue #716.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../..'
);

const read = (rel: string) => fs.readFileSync(path.join(rootDir, rel), 'utf8');

/** Compare license prose independent of wrapping and case. */
const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, ' ');

const PUBLIC_SUMMARIES = [
	'README.md',
	'docs/licensing.md',
	'apps/docs/licensing.md'
] as const;

/**
 * The Commons Clause definition of Sell, folded to lowercase. LICENSE is the
 * source of this sentence; the public summaries have to carry the same limit.
 */
const SELL_DEFINITION = [
	'for a fee or other consideration (including without limitation fees for',
	'hosting or consulting/support services related to the software), as part',
	'of a product or service whose value derives, entirely or substantially,',
	'from the functionality of the software.'
].join(' ');

/** README's Licensing section, or a whole licensing page. */
function licensingCopy(rel: string): string {
	const text = read(rel);
	if (rel !== 'README.md') {
		return text;
	}
	const heading = '## Licensing';
	const start = text.indexOf(heading);
	if (start < 0) {
		throw new Error('README.md has no Licensing section');
	}
	const rest = text.slice(start + heading.length);
	const next = rest.search(/\n## [^#]/);
	if (next < 0) {
		return text.slice(start);
	}
	return text.slice(start, start + heading.length + next);
}

describe('public licensing copy matches the Commons Clause', () => {
	const license = read('LICENSE');

	it('withholds the right to Sell and states that definition', () => {
		expect(license).toContain('the right to Sell the Software');
		expect(license).not.toMatch(/competing products/i);
		expect(license).not.toMatch(/as a hosted service/i);
		expect(normalize(license)).toContain(SELL_DEFINITION);
	});

	it.each(PUBLIC_SUMMARIES)(
		'%s states the Sell condition and drops the extra bans',
		(rel) => {
			const copy = licensingCopy(rel);
			expect(copy).toMatch(/MIT License with Commons Clause/);
			expect(copy).not.toMatch(/competing products/i);
			expect(copy).not.toMatch(/as a hosted service/i);
			expect(normalize(copy)).toContain('the right to sell');
			expect(normalize(copy)).toContain(SELL_DEFINITION);
		}
	);

	it.each(['docs/licensing.md', 'apps/docs/licensing.md'])(
		'%s names TaskGraph',
		(rel) => {
			const copy = read(rel);
			expect(copy).toContain('TaskGraph');
			expect(copy).not.toContain('Task Master');
		}
	);
});
