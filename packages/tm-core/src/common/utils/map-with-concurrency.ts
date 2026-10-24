/**
 * @fileoverview Run an async function over a list with at most `limit` calls
 * in flight, e.g. `expand --all` expanding three tasks at a time.
 */

/**
 * Call `fn` on every item, keeping at most `limit` calls running. A new call
 * starts as soon as one finishes. Results are in input order. A rejection
 * stops new calls from starting and rejects once the running ones settle;
 * catch inside `fn` to keep going past a failure.
 *
 * @param items - The work, in the order calls should start
 * @param limit - Most calls at once; values below 1 count as 1
 * @param fn - Called with each item and its index
 */
export async function mapWithConcurrency<T, R>(
	items: readonly T[],
	limit: number,
	fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
	const results = new Array<R>(items.length);
	let next = 0;
	let failed = false;
	const worker = async () => {
		while (!failed && next < items.length) {
			const index = next++;
			try {
				results[index] = await fn(items[index], index);
			} catch (error) {
				failed = true;
				throw error;
			}
		}
	};
	const workers = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
	const settled = await Promise.allSettled(
		Array.from({ length: workers }, worker)
	);
	const rejected = settled.find((s) => s.status === 'rejected');
	if (rejected) throw (rejected as PromiseRejectedResult).reason;
	return results;
}
