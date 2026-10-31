/**
 * @fileoverview Make text from files safe to print to a terminal.
 *
 * Task titles, details, notes, acceptance criteria and config values come
 * from files a user may have pulled from someone else's branch, or that an
 * AI command wrote from model output. Printed raw, an escape sequence in
 * them could clear the screen, rewrite earlier lines, set the window title,
 * write the clipboard (OSC 52) or show one link and open another (OSC 8).
 *
 * These helpers are for terminal output only. JSON output already escapes
 * control characters and must keep the stored text as it is.
 */

// Terminal escape sequences, 7-bit and 8-bit forms:
// - CSI: ESC [ or 0x9B, parameters, intermediates, one final byte
// - OSC, DCS, SOS, PM, APC: ESC ] P X ^ _ (or 0x9D 0x90 0x98 0x9E 0x9F),
//   then anything up to BEL or ST (ESC \ or 0x9C), or to the end of the text
// - any other ESC sequence: ESC, intermediates, one final byte (ESC c resets
//   the terminal, ESC ( B picks a character set)
const ESCAPE_SEQUENCE =
	// biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point
	/(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]|(?:\x1b[\]PX^_]|[\x9d\x90\x98\x9e\x9f])[^\x07\x1b\x9c]*(?:\x07|\x1b\\|\x9c)?|\x1b[ -/]*[0-~]/g;

// C0 controls except tab and newline, DEL, C1 controls, and the
// bidirectional marks and overrides that make text display differently
// from what it says
const CONTROL_CHARACTERS =
	// biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point
	/[\x00-\x08\x0b-\x1f\x7f-\x9f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

// The same, with tab and newline, for one-line text
const CONTROL_CHARACTERS_AND_LAYOUT =
	// biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point
	/[\x00-\x1f\x7f-\x9f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

export interface StripTerminalControlsOptions {
	/**
	 * Return one line: control characters and line breaks become spaces,
	 * runs of whitespace collapse to one space, and the ends are trimmed.
	 * Without it, newlines and tabs stay so multi-line text keeps its layout.
	 */
	singleLine?: boolean;
}

/**
 * Remove terminal escape sequences (CSI, OSC, DCS and the rest) and control
 * characters from text that came from a file or a model, before printing it.
 * Newlines and tabs stay unless `singleLine` is set; `\r\n` becomes `\n`.
 *
 * @example
 * stripTerminalControls('Fix \x1b]0;pwned\x07login\x1b[2J'); // 'Fix login'
 */
export function stripTerminalControls(
	text: string,
	options: StripTerminalControlsOptions = {}
): string {
	const withoutEscapes = text.replace(ESCAPE_SEQUENCE, '');
	if (options.singleLine) {
		return withoutEscapes
			.replace(CONTROL_CHARACTERS_AND_LAYOUT, ' ')
			.replace(/\s+/g, ' ')
			.trim();
	}
	return withoutEscapes.replace(/\r\n/g, '\n').replace(CONTROL_CHARACTERS, '');
}

/**
 * A copy of `value` with every string in it (in arrays and plain objects,
 * keys included) passed through `stripTerminalControls`. Use it on a task,
 * a list result or a config value right before rendering it as text, so
 * every field the formatters print is safe. Leaves `value` unchanged, and
 * returns anything that isn't a string, array or plain object as it is.
 */
export function sanitizeForTerminal<T>(value: T): T {
	// Iterative, so a deeply nested tree (a long dependency chain) can't
	// overflow the stack: each copy is made empty, then filled from `pending`
	const seen = new WeakMap<object, unknown>();
	const pending: Array<[object, unknown[] | Record<string, unknown>]> = [];
	const copyOf = (item: unknown): unknown => {
		if (typeof item === 'string') return stripTerminalControls(item);
		if (item === null || typeof item !== 'object') return item;

		const done = seen.get(item);
		if (done !== undefined) return done;

		let copy: unknown[] | Record<string, unknown>;
		if (Array.isArray(item)) {
			copy = [];
		} else {
			const proto = Object.getPrototypeOf(item);
			if (proto !== Object.prototype && proto !== null) return item;
			copy = {};
		}
		seen.set(item, copy);
		pending.push([item, copy]);
		return copy;
	};

	const result = copyOf(value);
	for (let next = pending.pop(); next; next = pending.pop()) {
		const [source, copy] = next;
		if (Array.isArray(copy)) {
			for (const item of source as unknown[]) copy.push(copyOf(item));
		} else {
			for (const [key, item] of Object.entries(source)) {
				copy[stripTerminalControls(key)] = copyOf(item);
			}
		}
	}
	return result as T;
}
