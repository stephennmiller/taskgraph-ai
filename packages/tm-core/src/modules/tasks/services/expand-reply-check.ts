/**
 * @fileoverview Tells a real expand reply from a stub: one subtask where
 * several were asked for, or placeholder text in place of a subtask (#721).
 */

/** A whole field that only stands in for text, such as "TBD" or "To be determined" */
const PLACEHOLDER_TEXT =
	/^(?:placeholder(?: (?:subtask|task|title|description|details|text))?|todo|tbd|tba|n\/?a|lorem ipsum.*|coming soon|details to follow|fill (?:this )?in(?: later)?|to be (?:determined|defined|decided|added|written|completed|filled in)(?: later)?)$/i;

function isPlaceholder(text: unknown): boolean {
	if (typeof text !== 'string') return false;
	const core = text.trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
	return core === '' || PLACEHOLDER_TEXT.test(core);
}

/**
 * Why a reply is no breakdown of the task: one subtask where several were
 * asked for, or a subtask that is only placeholder text (#721). Undefined
 * for a usable reply; a reply that isn't a subtasks array is checked later.
 */
export function degenerateReply(
	generated: unknown,
	asked: number
): string | undefined {
	if (!Array.isArray(generated) || generated.length === 0) return undefined;
	if (asked >= 2 && generated.length === 1) {
		return `1 subtask where ${asked} were asked for`;
	}
	const stub = generated.findIndex((s) =>
		[s?.title, s?.description, s?.details].some(isPlaceholder)
	);
	if (stub !== -1) return `placeholder text in subtask ${stub + 1}`;
	return undefined;
}
