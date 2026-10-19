/**
 * @fileoverview One quiet line of AI usage after a command, e.g.
 *
 *   sonnet · 121,129 tokens (108,386 in, 12,743 out)
 *
 * Cost is added only when there is one: Claude Code models are priced at $0
 * here, so a cost line would always read "$0.000000".
 */

/** The telemetry fields this line uses */
export interface UsageTelemetry {
	modelUsed?: string;
	inputTokens?: number;
	outputTokens?: number;
	totalTokens?: number;
	totalCost?: number;
	currency?: string;
	isUnknownCost?: boolean;
}

const number = (n: number) => Math.round(n).toLocaleString('en-US');

/** $0.0935, $1.24; costs under a cent show as <$0.01 */
export function formatCost(cost: number, currency = 'USD'): string {
	const symbol = currency === 'USD' ? '$' : `${currency} `;
	if (cost < 0.01) return `<${symbol}0.01`;
	return `${symbol}${cost.toFixed(cost < 1 ? 4 : 2)}`;
}

/** Returns null when there is nothing worth showing */
export function formatUsageLine(
	telemetry: UsageTelemetry | null | undefined
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
		`${number(total)} ${total === 1 ? 'token' : 'tokens'} (${number(input)} in, ${number(output)} out)`
	);
	if (!telemetry.isUnknownCost && (telemetry.totalCost ?? 0) > 0) {
		parts.push(
			`~${formatCost(telemetry.totalCost as number, telemetry.currency)}`
		);
	}
	return parts.join(' · ');
}
