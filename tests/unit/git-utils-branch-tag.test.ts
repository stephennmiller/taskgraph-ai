import {
	isValidBranchForTag,
	sanitizeBranchNameForTag
} from '../../scripts/modules/utils/git-utils.js';

describe('isValidBranchForTag', () => {
	it.each(['HEAD', 'head', 'main', 'master', 'develop', 'dev'])(
		'rejects the reserved name %s',
		(branch) => {
			expect(isValidBranchForTag(branch)).toBe(false);
		}
	);

	it('rejects a missing branch', () => {
		expect(isValidBranchForTag(null as any)).toBe(false);
	});

	it('accepts a feature branch and sanitizes it to a tag name', () => {
		expect(isValidBranchForTag('feature/login')).toBe(true);
		expect(sanitizeBranchNameForTag('feature/login')).toBe('feature-login');
	});
});
