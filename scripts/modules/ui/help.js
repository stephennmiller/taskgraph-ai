import boxen from 'boxen';
import chalk from 'chalk';
import Table from 'cli-table3';
import { TASKGRAPH_CONFIG_FILE } from '../../../src/constants/paths.js';
import { TASK_STATUS_OPTIONS } from '../../../src/constants/task-status.js';
import { BORDER_COLOR } from './theme.js';

/**
 * Display a comprehensive help guide
 */
export function displayHelp() {
	// Get terminal width - moved to top of function to make it available throughout
	const terminalWidth = process.stdout.columns || 100; // Default to 100 if can't detect

	console.log(
		boxen(chalk.bold('TaskGraph CLI'), {
			padding: 1,
			borderColor: BORDER_COLOR,
			borderStyle: 'round',
			margin: { top: 1, bottom: 1 }
		})
	);

	// Command categories
	const commandCategories = [
		{
			title: 'Project Setup & Configuration',
			color: 'blue',
			commands: [
				{
					name: 'init',
					args: '[--name=<name>] [--description=<desc>] [-y]',
					desc: 'Initialize a new project with TaskGraph structure'
				},
				{
					name: 'models',
					args: '',
					desc: 'View current AI model configuration and available models'
				},
				{
					name: 'models --setup',
					args: '',
					desc: 'Run interactive setup to configure AI models'
				},
				{
					name: 'models --set-main',
					args: '<model_id>',
					desc: 'Set the primary model for task generation'
				},
				{
					name: 'models --set-research',
					args: '<model_id>',
					desc: 'Set the model for research operations'
				},
				{
					name: 'models --set-fallback',
					args: '<model_id>',
					desc: 'Set the fallback model (optional)'
				},
				{
					name: 'completion --install',
					args: '',
					desc: 'Set up Tab completion for your shell'
				}
			]
		},
		{
			title: 'Task Generation',
			color: 'cyan',
			commands: [
				{
					name: 'parse-prd',
					args: '--input=<file.txt> [--num-tasks=10]',
					desc: 'Generate tasks from a PRD document'
				},
				{
					name: 'generate',
					args: '',
					desc: 'Create individual task files from tasks.json'
				}
			]
		},
		{
			title: 'Task Management',
			color: 'green',
			commands: [
				{
					name: 'list',
					args: '[<status>|all] [-s <status>] [-t <tag>]',
					desc: 'List all tasks - use "all" to show with subtasks'
				},
				{
					name: 'list',
					args: '[--with-subtasks] [-f <format>] [--json] [-c]',
					desc: 'Options: format (text/json/compact), subtasks'
				},
				{
					name: 'list',
					args: '[-w] [--ready] [--blocking] [--all-tags]',
					desc: 'Options: watch mode, ready/blocking filters, all tags'
				},
				{
					name: 'set-status',
					args: '<id> <status>',
					desc: `Update task status (${TASK_STATUS_OPTIONS.join(', ')})`
				},
				{
					name: 'sync-readme',
					args: '[--with-subtasks] [--status=<status>]',
					desc: 'Export tasks to README.md with professional formatting'
				},
				{
					name: 'update',
					args: '--from=<id> --prompt="<context>"',
					desc: 'Update multiple tasks based on new requirements'
				},
				{
					name: 'update-task',
					args: '<id> <prompt...>',
					desc: 'Update a single task (no quotes needed for multi-word prompts)'
				},
				{
					name: 'update-subtask',
					args: '--id=<parentId.subtaskId> --prompt="<context>"',
					desc: 'Append additional information to a subtask'
				},
				{
					name: 'add-task',
					args: '--prompt="<text>" [--dependencies=<ids>] [--priority=<priority>]',
					desc: 'Add a new task using AI'
				},
				{
					name: 'remove-task',
					args: '--id=<id> [-y]',
					desc: 'Permanently remove a task or subtask'
				}
			]
		},
		{
			title: 'Subtask Management',
			color: 'yellow',
			commands: [
				{
					name: 'add-subtask',
					args: '--parent=<id> --title="<title>" [--description="<desc>"]',
					desc: 'Add a new subtask to a parent task'
				},
				{
					name: 'add-subtask',
					args: '--parent=<id> --task-id=<id>',
					desc: 'Convert an existing task into a subtask'
				},
				{
					name: 'remove-subtask',
					args: '--id=<parentId.subtaskId> [--convert]',
					desc: 'Remove a subtask (optionally convert to standalone task)'
				},
				{
					name: 'clear-subtasks',
					args: '--id=<id>',
					desc: 'Remove all subtasks from specified tasks'
				},
				{
					name: 'clear-subtasks --all',
					args: '',
					desc: 'Remove subtasks from all tasks'
				}
			]
		},
		{
			title: 'Task Analysis & Breakdown',
			color: 'magenta',
			commands: [
				{
					name: 'analyze-complexity',
					args: '[--research] [--threshold=5]',
					desc: 'Analyze tasks and generate expansion recommendations'
				},
				{
					name: 'complexity-report',
					args: '[--file=<path>]',
					desc: 'Display the complexity analysis report'
				},
				{
					name: 'expand',
					args: '--id=<id> [--num=5] [--research] [--prompt="<context>"]',
					desc: 'Break down tasks into detailed subtasks'
				},
				{
					name: 'expand --all',
					args: '[--force] [--research]',
					desc: 'Expand all pending tasks with subtasks'
				},
				{
					name: 'research',
					args: '"<prompt>" [-i=<task_ids>] [-f=<file_paths>] [-c="<context>"] [--tree] [-s=<save_file>] [-d=<detail_level>]',
					desc: 'Perform AI-powered research queries with project context'
				}
			]
		},
		{
			title: 'Task Navigation & Viewing',
			color: 'cyan',
			commands: [
				{
					name: 'next',
					args: '',
					desc: 'Show the next task to work on based on dependencies'
				},
				{
					name: 'graph',
					args: '[--id=<id>]',
					desc: 'Show tasks as a dependency tree, with the next task marked'
				},
				{
					name: 'show',
					args: '<id>',
					desc: 'Display detailed information about a specific task'
				}
			]
		},
		{
			title: 'Tag Management',
			color: 'magenta',
			commands: [
				{
					name: 'tags',
					args: '[list] [--show-metadata] [--ready]',
					desc: 'List all available tags with task counts'
				},
				{
					name: 'tags add',
					args: '<name> [--description <desc>] [--copy-from <tag>]',
					desc: 'Create a new tag (--from-branch for git branch name)'
				},
				{
					name: 'tags use',
					args: '<name>',
					desc: 'Switch to a different tag context'
				},
				{
					name: 'tags remove',
					args: '<name> [-y]',
					desc: 'Delete an existing tag and all its tasks'
				},
				{
					name: 'tags rename',
					args: '<oldName> <newName>',
					desc: 'Rename an existing tag'
				},
				{
					name: 'tags copy',
					args: '<source> <target> [--description <desc>]',
					desc: 'Copy a tag with all its tasks'
				}
			]
		},
		{
			title: 'Dependency Management',
			color: 'blue',
			commands: [
				{
					name: 'add-dependency',
					args: '--id=<id> --depends-on=<id>',
					desc: 'Add a dependency to a task'
				},
				{
					name: 'remove-dependency',
					args: '--id=<id> --depends-on=<id>',
					desc: 'Remove a dependency from a task'
				},
				{
					name: 'validate-dependencies',
					args: '',
					desc: 'Identify invalid dependencies without fixing them'
				},
				{
					name: 'fix-dependencies',
					args: '',
					desc: 'Fix invalid dependencies automatically'
				}
			]
		}
	];

	// Display each category
	commandCategories.forEach((category) => {
		console.log(
			boxen(chalk[category.color].bold(category.title), {
				padding: { left: 2, right: 2, top: 0, bottom: 0 },
				margin: { top: 1, bottom: 0 },
				borderColor: category.color,
				borderStyle: 'round'
			})
		);

		// Calculate dynamic column widths - adjust ratios as needed
		const nameWidth = Math.max(25, Math.floor(terminalWidth * 0.2)); // 20% of width but min 25
		const argsWidth = Math.max(40, Math.floor(terminalWidth * 0.35)); // 35% of width but min 40
		const descWidth = Math.max(45, Math.floor(terminalWidth * 0.45) - 10); // 45% of width but min 45, minus some buffer

		const commandTable = new Table({
			colWidths: [nameWidth, argsWidth, descWidth],
			chars: {
				top: '',
				'top-mid': '',
				'top-left': '',
				'top-right': '',
				bottom: '',
				'bottom-mid': '',
				'bottom-left': '',
				'bottom-right': '',
				left: '',
				'left-mid': '',
				mid: '',
				'mid-mid': '',
				right: '',
				'right-mid': '',
				middle: ' '
			},
			style: { border: [], 'padding-left': 4 },
			wordWrap: true
		});

		category.commands.forEach((cmd, index) => {
			commandTable.push([
				`${chalk.yellow.bold(cmd.name)}${chalk.reset('')}`,
				`${chalk.reset(cmd.args)}${chalk.reset('')}`,
				`${chalk.dim(cmd.desc)}${chalk.reset('')}`
			]);
		});

		console.log(commandTable.toString());
		console.log('');
	});

	// Display configuration section
	console.log(
		boxen(chalk.cyan.bold('Configuration'), {
			padding: { left: 2, right: 2, top: 0, bottom: 0 },
			margin: { top: 1, bottom: 0 },
			borderColor: 'cyan',
			borderStyle: 'round'
		})
	);

	// Get terminal width if not already defined
	const configTerminalWidth = terminalWidth || process.stdout.columns || 100;

	// Calculate dynamic column widths for config table
	const configKeyWidth = Math.max(30, Math.floor(configTerminalWidth * 0.25));
	const configDescWidth = Math.max(50, Math.floor(configTerminalWidth * 0.45));
	const configValueWidth = Math.max(
		30,
		Math.floor(configTerminalWidth * 0.3) - 10
	);

	const configTable = new Table({
		colWidths: [configKeyWidth, configDescWidth, configValueWidth],
		chars: {
			top: '',
			'top-mid': '',
			'top-left': '',
			'top-right': '',
			bottom: '',
			'bottom-mid': '',
			'bottom-left': '',
			'bottom-right': '',
			left: '',
			'left-mid': '',
			mid: '',
			'mid-mid': '',
			right: '',
			'right-mid': '',
			middle: ' '
		},
		style: { border: [], 'padding-left': 4 },
		wordWrap: true
	});

	configTable.push(
		[
			`${chalk.yellow(TASKGRAPH_CONFIG_FILE)}${chalk.reset('')}`,
			`${chalk.reset('AI model configuration file (project root)')}${chalk.reset('')}`,
			`${chalk.dim('Managed by models cmd')}${chalk.reset('')}`
		],
		[
			`${chalk.yellow('Claude Code')}${chalk.reset('')}`,
			`${chalk.reset('Install and sign in to Claude Code (no API keys needed)')}${chalk.reset('')}`,
			`${chalk.dim('Required on PATH')}${chalk.reset('')}`
		]
	);

	console.log(configTable.toString());
	console.log('');

	// Show helpful hints
	console.log(
		boxen(
			chalk.bold('Quick Start:') +
				'\n\n' +
				chalk.cyan('1. Create Project: ') +
				chalk.reset('taskgraph init') +
				'\n' +
				chalk.cyan('2. Setup Models: ') +
				chalk.reset('taskgraph models --setup') +
				'\n' +
				chalk.cyan('3. Parse PRD: ') +
				chalk.reset('taskgraph parse-prd --input=<prd-file>') +
				'\n' +
				chalk.cyan('4. List Tasks: ') +
				chalk.reset('taskgraph list') +
				'\n' +
				chalk.cyan('5. Find Next Task: ') +
				chalk.reset('taskgraph next'),
			{
				padding: 1,
				borderColor: 'yellow',
				borderStyle: 'round',
				margin: { top: 1 },
				width: Math.min(configTerminalWidth - 10, 100) // Limit width to terminal width minus padding, max 100
			}
		)
	);
}
