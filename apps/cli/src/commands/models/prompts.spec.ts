import { describe, expect, it } from 'vitest';
import { buildModelChoices, modelPromptMessage } from './prompts.js';

const MODELS = ['opus', 'sonnet', 'haiku'].map((id) => ({
	id,
	allowed_roles: ['main', 'research', 'fallback'] as const
}));

const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');

describe('buildModelChoices', () => {
	it('marks the current model and notes what each is good at', () => {
		const choices = buildModelChoices('main', MODELS as never, 'sonnet');

		expect(choices.map((choice) => plain(choice.name))).toEqual([
			'opus    most capable',
			'sonnet  balanced · current',
			'haiku   fastest'
		]);
		expect(choices.map((choice) => choice.value)).toEqual([
			'opus',
			'sonnet',
			'haiku'
		]);
	});

	it('leaves out models the role cannot use', () => {
		const models = [
			...MODELS,
			{ id: 'mini', allowed_roles: ['fallback'] as const }
		];

		const choices = buildModelChoices('main', models as never, null);

		expect(choices.map((choice) => choice.value)).not.toContain('mini');
	});
});

describe('modelPromptMessage', () => {
	it('names the role and what it is for', () => {
		expect(modelPromptMessage('fallback')).toBe(
			'Fallback model (used if the main model fails)'
		);
	});
});
