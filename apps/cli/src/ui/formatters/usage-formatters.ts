/**
 * @fileoverview One quiet line of AI usage after a command, e.g.
 *
 *   sonnet · 121,129 tokens (108,386 in, 12,743 out)
 *
 * Cost is added only when there is one: Claude Code models are priced at $0
 * here, so a cost line would always read "$0.000000". The cached share is
 * added when it's at least 1%: Claude Code sends a large, mostly cached
 * context with every call, which otherwise makes small commands look huge.
 */

/** The telemetry fields this line uses */
export interface UsageTelemetry {
	modelUsed?: string;
	inputTokens?: number;
	outputTokens?: number;
	/** Part of inputTokens read from the prompt cache */
	cachedInputTokens?: number;
	totalTokens?: number;
	totalCost?: number;
	currency?: string;
	isUnknownCost?: boolean;
}

/** Grouped for the reader's locale: 121,129 in en-US, 121.129 in de-DE */
const number = (n: number, locale?: string) =>
	Math.round(n).toLocaleString(locale);

/** $0.0935, $1.24, €2.00; costs under a cent show as <$0.01 */
export function formatCost(
	cost: number,
	currency = 'USD',
	locale?: string
): string {
	const format = (value: number, options: Intl.NumberFormatOptions) => {
		try {
			return new Intl.NumberFormat(locale, {
				style: 'currency',
				currency,
				...options
			}).format(value);
		} catch {
			return `${currency} ${value.toFixed(2)}`;
		}
	};
	if (cost < 0.01) return `<${format(0.01, { maximumFractionDigits: 2 })}`;
	return cost < 1
		? format(cost, { maximumSignificantDigits: 3 })
		: format(cost, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

/** Returns null when there is nothing worth showing */
export function formatUsageLine(
	telemetry: UsageTelemetry | null | undefined,
	locale?: string
): string | null {
	if (!telemetry) return null;
	const input = telemetry.inputTokens ?? 0;
	const output = telemetry.outputTokens ?? 0;
	const total = telemetry.totalTokens || input + output;
	if (!total) return null;

	const parts: string[] = [];
	const model = telemetry.modelUsed;
	if (model) parts.push(model === 'Multiple' ? 'several models' : model);
	parts.push(
		`${number(total, locale)} ${total === 1 ? 'token' : 'tokens'} (${number(input, locale)} in, ${number(output, locale)} out)`
	);
	const cached = telemetry.cachedInputTokens ?? 0;
	if (input > 0 && cached / input >= 0.01) {
		parts.push(`${Math.round((cached / input) * 100)}% cached`);
	}
	if (!telemetry.isUnknownCost && (telemetry.totalCost ?? 0) > 0) {
		parts.push(
			`~${formatCost(telemetry.totalCost as number, telemetry.currency, locale)}`
		);
	}
	return parts.join(' · ');
}
