/**
 * @fileoverview TaskGraph terminal theme
 *
 * Brand colors are truecolor hex; chalk downsamples them on 256- and 16-color
 * terminals (the primary and accent blues fall back to ANSI cyan).
 * Semantic colors (success, warning, error, muted) stay on the terminal's own
 * ANSI palette so they follow whatever theme the user has configured.
 *
 * The brand blues keep at least 3:1 contrast on both dark (#0D1117, #1E1E1E)
 * and light (#FFFFFF, #FDF6E3) terminal backgrounds.
 */

import chalk from 'chalk';

export const BRAND_COLORS = {
	/** Brand text: headings, highlights, in-progress work */
	primary: '#0088CC',
	/** Box borders and decorative accents */
	accent: '#0096C7',
	/** Deepest stop of the banner gradient */
	deep: '#0077B6'
} as const;

/** Gradient for the ASCII banner */
export const BANNER_GRADIENT = [
	BRAND_COLORS.accent,
	BRAND_COLORS.primary,
	BRAND_COLORS.deep
];

/** Border color for neutral / informational boxes (boxen accepts hex) */
export const BORDER_COLOR = BRAND_COLORS.accent;

export const theme = {
	/** Brand-colored text */
	brand: chalk.hex(BRAND_COLORS.primary),
	/** Section headings and box titles */
	heading: chalk.hex(BRAND_COLORS.primary).bold,
	/** Secondary labels such as tags and skills */
	accent: chalk.hex(BRAND_COLORS.accent),
	/** In-progress / actively worked status */
	active: chalk.hex(BRAND_COLORS.primary),
	/**
	 * Body text in the terminal's default foreground. Replaces chalk.white,
	 * which many light themes render as pale gray.
	 */
	text: chalk.reset
};
