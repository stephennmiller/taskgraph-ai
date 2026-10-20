import { ui } from '@tm/cli';

/**
 * Display the help screen: commands grouped around the daily workflow
 */
export function displayHelp() {
	console.log(ui.formatHelp());
}
