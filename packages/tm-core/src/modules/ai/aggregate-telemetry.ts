/**
 * @fileoverview One usage record for a command that made several AI calls
 * (expand --all, scope-up/down), as the legacy utils.js built it.
 */

import type { AiTelemetryData } from './ai-service.js';

export interface AggregatedTelemetry {
	timestamp: string;
	userId: string;
	commandName: string;
	/** "Multiple" when the calls used different models */
	modelUsed: string;
	/** "Multiple" when the calls used different providers */
	providerName: string;
	inputTokens: number;
	outputTokens: number;
	cachedInputTokens: number;
	totalTokens: number;
	totalCost: number;
	currency: string;
}

/**
 * Sum the calls' tokens and cost under `commandName`; null for no calls.
 */
export function aggregateTelemetry(
	telemetry: Array<Partial<AiTelemetryData>> | null | undefined,
	commandName: string
): AggregatedTelemetry | null {
	if (!telemetry || telemetry.length === 0) return null;

	const aggregated: AggregatedTelemetry = {
		timestamp: new Date().toISOString(),
		userId: telemetry[0].userId as string,
		commandName,
		modelUsed: 'Multiple',
		providerName: 'Multiple',
		inputTokens: 0,
		outputTokens: 0,
		cachedInputTokens: 0,
		totalTokens: 0,
		totalCost: 0,
		currency: telemetry[0].currency || 'USD'
	};
	const models = new Set<string | undefined>();
	const providers = new Set<string | undefined>();
	const currencies = new Set<string>();
	for (const item of telemetry) {
		aggregated.inputTokens += item.inputTokens || 0;
		aggregated.outputTokens += item.outputTokens || 0;
		aggregated.cachedInputTokens += item.cachedInputTokens || 0;
		aggregated.totalCost += item.totalCost || 0;
		models.add(item.modelUsed);
		providers.add(item.providerName);
		currencies.add(item.currency || 'USD');
	}
	aggregated.totalTokens = aggregated.inputTokens + aggregated.outputTokens;
	aggregated.totalCost = parseFloat(aggregated.totalCost.toFixed(6));
	if (models.size === 1) aggregated.modelUsed = [...models][0] as string;
	if (providers.size === 1) {
		aggregated.providerName = [...providers][0] as string;
	}
	aggregated.currency = currencies.size > 1 ? 'Multiple' : [...currencies][0];
	return aggregated;
}
