import MODEL_MAP from '../../packages/tm-core/src/modules/ai/supported-models.json' with {
	type: 'json'
};

const CLAUDE_CODE_MODELS = ['opus', 'sonnet', 'haiku'];

describe('supported-models.json', () => {
	it('lists Claude Code as the only provider', () => {
		expect(Object.keys(MODEL_MAP)).toEqual(['claude-code']);
	});

	it.each(CLAUDE_CODE_MODELS)('lists %s as supported for every role', (id) => {
		const model = MODEL_MAP['claude-code'].find((m) => m.id === id);

		expect(model).toBeDefined();
		expect(model.supported).toBe(true);
		expect(model.allowed_roles).toEqual(
			expect.arrayContaining(['main', 'research', 'fallback'])
		);
	});

	it('lists exactly the Claude Code model aliases', () => {
		expect(MODEL_MAP['claude-code'].map((m) => m.id).sort()).toEqual(
			[...CLAUDE_CODE_MODELS].sort()
		);
	});

	it('does not charge per token, since Claude Code uses the signed-in plan', () => {
		for (const model of MODEL_MAP['claude-code']) {
			expect(model.cost_per_1m_tokens).toEqual({ input: 0, output: 0 });
		}
	});
});
