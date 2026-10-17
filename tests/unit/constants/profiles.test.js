import {
	RULE_PROFILES,
	findInvalidRulesProfiles,
	isValidRulesProfile
} from '../../../src/constants/profiles.js';
import * as profiles from '../../../src/profiles/index.js';

describe('rule profiles', () => {
	it('supports only the claude profile', () => {
		expect(RULE_PROFILES).toEqual(['claude']);
	});

	it('exports only the claude profile implementation', () => {
		expect(Object.keys(profiles)).toEqual(['claudeProfile']);
	});

	it.each(['cursor', 'roo', 'windsurf', 'vscode', 'codex', 'gemini', ''])(
		'rejects non-Claude profile "%s"',
		(name) => {
			expect(isValidRulesProfile(name)).toBe(false);
		}
	);

	it('accepts claude', () => {
		expect(isValidRulesProfile('claude')).toBe(true);
	});

	describe('findInvalidRulesProfiles', () => {
		it('returns nothing for valid names', () => {
			expect(findInvalidRulesProfiles(['claude'])).toEqual([]);
		});

		it('returns removed editor profiles in input order', () => {
			expect(
				findInvalidRulesProfiles(['cursor', 'claude', 'windsurf'])
			).toEqual(['cursor', 'windsurf']);
		});

		it('returns an empty list for no input', () => {
			expect(findInvalidRulesProfiles([])).toEqual([]);
		});
	});
});
