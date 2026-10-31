/**
 * A timeout in milliseconds from an env var, else the fallback. Capped at
 * Node's longest timer (about 24 days): a longer one fires after 1 ms.
 */
export function timeoutFromEnv(name: string, fallbackMs: number): number {
	// Whole milliseconds: Node's timers and AbortSignal.timeout throw on a fraction
	const configured = Math.floor(Number(process.env[name]));
	if (!(Number.isFinite(configured) && configured > 0)) return fallbackMs;
	return Math.min(configured, 2 ** 31 - 1);
}

/** A limit for a message: "10 minutes", "1 minute", or "30 seconds" under a minute */
export function formatTimeout(ms: number): string {
	const [n, unit] =
		ms >= 60000
			? [Math.round(ms / 60000), 'minute']
			: [Math.round(ms / 1000), 'second'];
	return `${n} ${unit}${n === 1 ? '' : 's'}`;
}
