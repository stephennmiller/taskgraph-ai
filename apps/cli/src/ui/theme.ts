/**
 * @fileoverview TaskGraph terminal theme
 *
 * Text uses the terminal's own ANSI palette, so it follows whatever theme the
 * user has configured. No single fixed color reaches 4.5:1 contrast on both
 * dark and light backgrounds, so brand hex colors are reserved for non-text
 * elements (box borders) and the large banner, where 3:1 is enough.
 *
 * Brand blues and their contrast on #0D1117 / #1E1E1E / #FFFFFF / #FDF6E3:
 *   accent  #0096C7  5.6 / 4.9 / 3.4 / 3.1
 *   primary #0088CC  4.9 / 4.3 / 3.9 / 3.6
 *   deep    #0080C0  4.4 / 3.8 / 4.3 / 4.0
 * All three fall back to ANSI cyan on 16-color terminals.
 */

import chalk from 'chalk';

export const BRAND_COLORS = {
	primary: '#0088CC',
	accent: '#0096C7',
	deep: '#0080C0'
} as const;

/** Gradient for the ASCII banner (large text, 3:1 minimum) */
export const BANNER_GRADIENT = [
	BRAND_COLORS.accent,
	BRAND_COLORS.primary,
	BRAND_COLORS.deep
];

/**
 * cli-table3 `style.border` value. The library's own default is 'grey' (bright
 * black), invisible on Solarized Dark; dimming the default foreground is not.
 */
export const TABLE_BORDER = ['dim'];

export const theme = {
	/** Brand-colored text */
	brand: chalk.cyan,
	/** Section headings and box titles */
	heading: chalk.cyan.bold,
	/** Secondary labels such as tags and skills */
	accent: chalk.magenta,
	/** In-progress / actively worked status (bold, so it differs from plain cyan IDs) */
	active: chalk.cyan.bold,
	/**
	 * De-emphasized text such as low priority or inactive statuses. Dims the
	 * default foreground instead of using chalk.gray (bright black), which is
	 * nearly invisible on Solarized Dark and similar themes.
	 */
	muted: chalk.dim,
	/**
	 * Body text in the terminal's default foreground. Replaces chalk.white,
	 * which many light themes render as pale gray. Plain chalk adds no color
	 * code, so unlike chalk.reset it never cancels an enclosing bold or italic.
	 */
	text: chalk
};
