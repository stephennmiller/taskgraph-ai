import MODEL_MAP from '../../scripts/modules/supported-models.json' with {
	type: 'json'
};

const LATEST_ANTHROPIC = [
	'claude-fable-5-1',
	'claude-opus-5-5',
	'claude-sonnet-5-5',
	'claude-haiku-5-5'
];

const RETIRED_ANTHROPIC = [
	'claude-3-5-sonnet-20241022',
	'claude-3-7-sonnet-20250219',
	'claude-sonnet-4-20250514',
	'claude-opus-4-20250514'
];

const byId = (provider, id) => MODEL_MAP[provider].find((m) => m.id === id);

describe('supported-models.json (anthropic)', () => {
	it.each(LATEST_ANTHROPIC)('lists %s as supported for main/fallback', (id) => {
		const model = byId('anthropic', id);
		expect(model).toBeDefined();
		expect(model.supported).toBe(true);
		expect(model.allowed_roles).toEqual(
			expect.arrayContaining(['main', 'fallback'])
		);
	});

	it.each(RETIRED_ANTHROPIC)(
		'keeps %s resolvable but hides it from selection',
		(id) => {
			const model = byId('anthropic', id);
			expect(model).toBeDefined();
			expect(model.supported).toBe(false);
		}
	);

	// Source: platform.claude.com/docs/en/about-claude/pricing and models/overview.
	// Haiku 5.5 is tiered by prompt length; base tier (prompts <= 100k) is listed.
	it.each([
		['claude-fable-5-1', 10, 50],
		['claude-opus-5-5', 4, 20],
		['claude-sonnet-5-5', 2, 10],
		['claude-haiku-5-5', 0.1, 0.5]
	])(
		'lists official pricing and 128K max output for %s',
		(id, input, output) => {
			const model = byId('anthropic', id);
			expect(model.cost_per_1m_tokens).toEqual({ input, output });
			expect(model.max_tokens).toBe(128000);
		}
	);

	// Anthropic publishes no SWE-bench figure for the 5.5 family, so don't invent one.
	it('leaves swe_score null rather than shipping an unverified number', () => {
		for (const id of LATEST_ANTHROPIC) {
			expect(byId('anthropic', id).swe_score ?? null).toBeNull();
		}
	});
});
