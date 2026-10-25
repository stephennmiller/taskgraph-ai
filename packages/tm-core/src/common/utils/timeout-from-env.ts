/**
 * A timeout in milliseconds from an env var, else the fallback. Capped at
 * Node's longest timer (about 24 days): a longer one fires after 1 ms.
 */
export function timeoutFromEnv(name: string, fallbackMs: number): number {
	const configured = Number(process.env[name]);
	if (!(Number.isFinite(configured) && configured > 0)) return fallbackMs;
	return Math.min(configured, 2 ** 31 - 1);
}
