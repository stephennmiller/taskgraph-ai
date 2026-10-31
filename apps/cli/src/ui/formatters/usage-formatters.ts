/**
 * @fileoverview One quiet line of AI usage after a command, e.g.
 *
 *   sonnet · 121,129 tokens (108,386 in, 12,743 out)
 *
 * Cost is added only when there is one: Claude Code models are priced at $0
 * here, so a cost line would always read "$0.000000". The cached share is
 * added when it's at least 1%: Claude Code sends a large, mostly cached
 * context with every call, which otherwise makes small commands look huge.
 *
 * `loop` adds what each iteration or task ran on and spent:
 * ` · sonnet, low effort · $0.42 · 12 turns · 3m 10s`.
 */

import { formatDuration } from '../components/parse-prd-progress.component.js';
import { theme } from '../theme.js';

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

/**
 * ` · resumed · sonnet, low effort · $0.42 · 12 turns · 3m 10s`, muted, for
 * the end of a `loop` line; leaves out what wasn't picked or reported, and is
 * empty when there's nothing
 */
export function formatLoopSpend(spend: {
	/** `resumed` or `fresh`: whether the iteration reused the last Claude Code session */
	session?: string;
	model?: string;
	effort?: string;
	costUsd?: number;
	/** costUsd is what loop counted, not what Claude Code reported */
	costUnknown?: boolean;
	/** A total that leaves out a cost nobody knows: shown as `at least` */
	costPartial?: boolean;
	turns?: number;
	durationMs?: number;
}): string {
	const setting = [spend.model, spend.effort && `${spend.effort} effort`]
		.filter(Boolean)
		.join(', ');
	const facts = [
		spend.session ?? null,
		setting || null,
		spend.costUsd !== undefined
			? `${spend.costUnknown ? 'cost unknown, counted as ' : spend.costPartial ? 'at least ' : ''}${formatCost(spend.costUsd)}`
			: spend.costUnknown || spend.costPartial
				? 'cost unknown'
				: null,
		spend.turns !== undefined
			? `${spend.turns} ${spend.turns === 1 ? 'turn' : 'turns'}`
			: null,
		spend.durationMs !== undefined ? formatDuration(spend.durationMs) : null
	].filter(Boolean);
	return facts.length ? theme.muted(` · ${facts.join(' · ')}`) : '';
}
