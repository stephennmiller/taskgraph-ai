import { theme } from '@tm/cli/theme';
import chalk from 'chalk';

/**
 * Build the "next steps" text shown after `taskgraph init` for a local
 * (non-Hamster) project.
 * @returns {string} Chalk-styled message for display in a box
 */
export function getLocalGettingStartedMessage() {
	const step = (number, title) =>
		`${theme.text(`${number}. `)}${chalk.yellow(title)}`;
	const branch = (last, text) =>
		`${theme.text(last ? '   └─ ' : '   ├─ ')}${text}`;
	const cli = (command) => `${chalk.dim('CLI: ')}${chalk.cyan(command)}`;

	const lines = [
		step(1, 'Choose your AI models (optional)'),
		branch(
			false,
			`${chalk.dim('Models: Use ')}${chalk.cyan('taskgraph models --setup')}`
		),
		branch(
			true,
			chalk.dim(
				'AI calls run through your signed-in Claude Code (run `claude` once to sign in)'
			)
		),
		step(2, 'Discuss your idea with AI and create a PRD'),
		branch(
			false,
			`${chalk.dim('Simple projects: Use ')}${chalk.cyan('example_prd.txt')}${chalk.dim(' template')}`
		),
		branch(
			true,
			`${chalk.dim('Complex systems: Use ')}${chalk.cyan('example_prd_rpg.txt')}${chalk.dim(' template')}`
		),
		step(3, 'Parse your PRD to generate initial tasks'),
		branch(true, cli('taskgraph parse-prd .taskgraph/docs/prd.md')),
		step(4, 'Analyze task complexity'),
		branch(true, cli('taskgraph analyze-complexity --research')),
		step(5, 'Expand tasks into subtasks'),
		branch(true, cli('taskgraph expand --all --research')),
		step(6, 'Start working on tasks'),
		branch(true, cli('taskgraph next')),
		`${theme.text('7. ')}${chalk.green.bold('Ship it!')}`
	];

	const footer = `${chalk.dim('* Run ')}${chalk.cyan('taskgraph --help')}${chalk.dim(' to see all available commands')}`;

	return `${chalk.cyan.bold('Things you should do next:')}\n\n${lines.join('\n')}\n\n${footer}`;
}
