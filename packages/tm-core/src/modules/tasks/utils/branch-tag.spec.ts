/**
 * @fileoverview Branch name to tag name
 */

import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '../../../common/errors/taskgraph-error.js';
import { tagNameForBranch } from './branch-tag.js';

describe('tagNameForBranch', () => {
	it.each([
		['feature/login', 'feature-login'],
		['Feature/Login', 'feature-login'],
		['fix//double--dash', 'fix-double-dash'],
		['/leading-and-trailing/', 'leading-and-trailing'],
		// A dot is not allowed in a tag name, so it cannot survive (#221)
		['release/1.2', 'release-1-2'],
		['user_name/topic', 'user_name-topic']
	])('turns %s into %s', (branch, tag) => {
		expect(tagNameForBranch(branch)).toBe(tag);
	});

	it('keeps at most 50 characters', () => {
		expect(tagNameForBranch(`feature/${'x'.repeat(80)}`)).toHaveLength(50);
	});

	it.each(['main', 'master', 'develop', 'dev', 'HEAD', 'head', 'Main'])(
		'rejects the reserved branch %s',
		(branch) => {
			expect(() => tagNameForBranch(branch)).toThrow(
				expect.objectContaining({
					code: ERROR_CODES.INVALID_BRANCH_FOR_TAG,
					message: `Branch "${branch}" cannot be converted to a valid tag name`
				})
			);
		}
	);

	it('rejects a branch with nothing usable in its name', () => {
		expect(() => tagNameForBranch('///')).toThrow(
			expect.objectContaining({ code: ERROR_CODES.INVALID_BRANCH_FOR_TAG })
		);
	});
});
