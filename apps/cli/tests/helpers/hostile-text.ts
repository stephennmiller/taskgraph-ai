/**
 * Task text with terminal escape sequences in it, as a tasks.json or
 * config.json pulled from someone else's branch could carry (#287): a screen
 * clear, an OSC title change ended by BEL and an OSC 8 link ended by ST.
 * Printed safely, it reads `Fix login`.
 */
export const HOSTILE =
	'Fix\x1b[2J\x1b]0;pwned\x07 login\x1b]8;;http://evil\x1b\\';

/** Anything left of HOSTILE that a terminal would act on, or its payload */
export const UNSAFE = /[\x00-\x08\x0b-\x1f\x7f-\x9f]|pwned|evil/;

/** Output without the formatter's own colors, so only leaks remain */
export const sgrFree = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');
