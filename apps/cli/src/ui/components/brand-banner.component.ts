/**
 * @fileoverview Brand banner component
 * Displays the TaskGraph ASCII art banner with gradient colors
 * Can be hidden by setting TM_HIDE_BANNER=true
 */

import chalk from 'chalk';
import figlet from 'figlet';
import gradient from 'gradient-string';
import { createLink } from '../formatters/link-formatters.js';
import { BANNER_GRADIENT } from '../theme.js';

// Brand gradient for the banner
const coolGradient = gradient(BANNER_GRADIENT);

export interface AsciiBannerOptions {
	/** Version string to display */
	version?: string;
	/** Project name to display (kept for compatibility but not displayed) */
	projectName?: string;
	/** Skip the version/project info box (kept for compatibility) */
	skipInfoBox?: boolean;
}

/**
 * Check if banner should be hidden via environment variable
 */
function isBannerHidden(): boolean {
	return process.env.TM_HIDE_BANNER === 'true';
}

/** Arguments that ask for the top-level help screen */
const TOP_LEVEL_HELP_ARGS = new Set(['--help', '-h', 'help']);

/**
 * Whether `runCLI` should print the ASCII banner before a command.
 *
 * Only bare `taskgraph` and the top-level help screen (`taskgraph --help`,
 * `-h`, `help`) get the banner. Routine commands lead with their result and
 * `init` prints its own banner. Pipes and redirects never get one, and
 * `--no-banner` still turns it off.
 *
 * @param args - The arguments after the script path (`process.argv.slice(2)`)
 * @param isTTY - Whether stdout is a terminal
 */
export function shouldShowAsciiBanner(args: string[], isTTY: boolean): boolean {
	if (!isTTY || args.includes('--no-banner')) return false;
	if (args.length === 0) return true;
	return args.length === 1 && TOP_LEVEL_HELP_ARGS.has(args[0]);
}

/**
 * Get terminal width for right-aligning content
 */
function getTerminalWidth(): number {
	return process.stdout.columns || 80;
}

/**
 * Display the fancy ASCII art banner for the CLI
 * Can be hidden by setting TM_HIDE_BANNER=true
 */
export function displayAsciiBanner(options: AsciiBannerOptions = {}): void {
	if (isBannerHidden()) return;

	const { version } = options;

	// Render ASCII banner
	try {
		const bannerText = figlet.textSync('TaskGraph', {
			font: 'Standard',
			horizontalLayout: 'default',
			verticalLayout: 'default'
		});
		console.log(coolGradient(bannerText));
	} catch {
		console.log(coolGradient('=== TaskGraph ==='));
	}

	// Credits line with version right-aligned. Link text already names the
	// destination, so unsupported terminals get the text without the long URL.
	const creditText = 'x.com/stephennmiller_';
	const xLink = createLink(creditText, 'https://x.com/stephennmiller_', {
		textOnlyFallback: true
	});
	const byText = chalk.dim('by ') + chalk.cyan(xLink);

	// Version with clickable link to GitHub release
	const cleanVersion = version ? version.replace(/^v/, '') : '';
	const releaseUrl = `https://github.com/stephennmiller/taskgraph-ai/releases/tag/taskgraph-ai%40${cleanVersion}`;
	const versionLink = version
		? createLink(`v${cleanVersion}`, releaseUrl, {
				color: 'dim',
				textOnlyFallback: true
			})
		: '';

	if (versionLink) {
		// Right-align the version when it fits; otherwise put it on its own line
		const byLength = `by ${creditText}`.length;
		const versionLength = cleanVersion.length + 1; // "v" + version
		const spacing = getTerminalWidth() - byLength - versionLength - 1;
		if (spacing >= 2) {
			console.log(byText + ' '.repeat(spacing) + versionLink);
		} else {
			console.log(byText);
			console.log(versionLink);
		}
	} else {
		console.log(byText);
	}

	console.log('');
}

/**
 * Display a simpler initialization banner
 * Used during project initialization
 */
export function displayInitBanner(): void {
	if (isBannerHidden()) return;

	// Render ASCII banner
	try {
		const bannerText = figlet.textSync('TaskGraph', {
			font: 'Standard',
			horizontalLayout: 'default',
			verticalLayout: 'default'
		});
		console.log(coolGradient(bannerText));
	} catch {
		console.log(coolGradient('=== TaskGraph ==='));
	}

	// Credits line
	const xLink = createLink(
		'x.com/stephennmiller_',
		'https://x.com/stephennmiller_',
		{ textOnlyFallback: true }
	);
	console.log(chalk.dim('by ') + chalk.cyan(xLink));
	console.log('');
}
