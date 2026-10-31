import { describe, expect, it } from 'vitest';
import {
	DEFAULT_RESUME_MAX_CONTEXT_TOKENS,
	resolveResumeLimit
} from './session-resume.js';

describe('resolveResumeLimit', () => {
	it('takes loop.resumeMaxContextTokens, or the default without one', () => {
		expect(resolveResumeLimit({ resumeMaxContextTokens: 60_000 })).toBe(60_000);
		expect(resolveResumeLimit({ resumeMaxContextTokens: 0 })).toBe(0);
		expect(resolveResumeLimit(undefined)).toBe(
			DEFAULT_RESUME_MAX_CONTEXT_TOKENS
		);
		expect(resolveResumeLimit({ bands: [] })).toBe(
			DEFAULT_RESUME_MAX_CONTEXT_TOKENS
		);
	});

	it.each([-1, 1.5, '100000', null, Number.NaN])(
		'refuses %j and names the key',
		(value) => {
			expect(() =>
				resolveResumeLimit({ resumeMaxContextTokens: value })
			).toThrow('loop.resumeMaxContextTokens');
		}
	);
});
