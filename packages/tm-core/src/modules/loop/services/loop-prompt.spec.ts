import { describe, expect, it } from 'vitest';
import type { LoopConfig } from '../types.js';
import { buildPrompt } from './loop-prompt.js';

describe('buildPrompt', () => {
	const prompt = (preset: string, tag?: string) =>
		buildPrompt(
			{
				prompt: preset,
				iterations: 1,
				progressFile: 'p.txt',
				tag
			} as LoopConfig,
			1
		);

	it("keeps master's bare commit marker and names any other tag in it (#1015)", async () => {
		expect(await prompt('default', 'master')).toContain('[task <id>]');
		expect(await prompt('default', 'billing')).toContain('[task billing/<id>]');
		expect(await prompt('default', 'billing')).not.toContain('[task <id>]');
		expect(await prompt('tdd', 'billing')).toContain(
			'[task billing/<id>.<subtask id>]'
		);
	});
});
