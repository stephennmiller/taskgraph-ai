/**
 * @fileoverview `taskgraph init`: set up TaskGraph in the current folder
 * through tm-core's initializeProject. Asks about Git, task storage, Claude
 * Code, the response language and the `tm` alias unless flags or --yes
 * answer them, then runs `taskgraph models --setup` and prints a summary.
 * `init --merge-driver` only sets up the tasks.json merge driver.
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import {
	RULE_PROFILES,
	type InitProblem,
	UPSTREAM_DIR,
	UPSTREAM_IMPORT_FLAG,
	UPSTREAM_IMPORT_OPTION,
	UPSTREAM_NAME,
	UpstreamImportError,
	aliasMissingFile,
	checkUpstreamImport,
	findInvalidRulesProfiles,
	findProjectRoot,
	initializeProject,
	insideGitWorkTree,
	planInit,
	resolveStoreTasksInGit,
	setUpMergeDriver
} from '@tm/core';
import chalk from 'chalk';
import { Command } from 'commander';
import { displayPath } from '../completion/install.js';
import { displayInitBanner } from '../ui/components/brand-banner.component.js';
import {
	formatInitDryRun,
	formatInitSummary
} from '../ui/formatters/init-summary-formatters.js';
import { terminalSafe } from '../ui/formatters/markdown-formatters.js';
import { formatMergeDriverSetup } from '../ui/formatters/merge-driver-formatters.js';
import { formatUpstreamImport } from '../ui/formatters/upstream-import-formatters.js';
import { theme } from '../ui/theme.js';
import { displayError, printError } from '../utils/error-handler.js';

interface InitCommandOptions {
	yes?: boolean;
	name?: string;
	description?: string;
	rules?: string[];
	claude?: boolean;
	mcp?: boolean;
	dryRun?: boolean;
	aliases?: boolean;
	git?: boolean;
	gitTasks?: boolean;
	mergeDriver?: boolean;
	[UPSTREAM_IMPORT_OPTION]?: boolean;
}

/** The answers init needs, from flags or prompts */
interface InitAnswers {
	initGit: boolean;
	storeTasksInGit: boolean;
	claudeCode: boolean;
	responseLanguage: string;
	aliases: boolean;
}

/** Ctrl-C at a prompt */
class InitCancelled extends Error {}

const answerLine = (question: string, yes: boolean) =>
	`${theme.brand(question)} ${yes ? chalk.green('✓') : chalk.dim('–')} ${chalk.dim(yes ? 'Yes' : 'No')}`;

/** One step init couldn't finish, shown as it happens */
const printInitProblem = (problem: InitProblem) => {
	if (problem.level === 'error') {
		console.error(chalk.red('✗'), chalk.red(terminalSafe(problem.message)));
	} else {
		console.warn(
			chalk.yellow('!'),
			chalk.yellow(terminalSafe(problem.message))
		);
	}
};

export class InitCommand extends Command {
	constructor(name?: string) {
		super(name || 'init');

		this.description('Initialize a new project with TaskGraph structure')
			.option('-y, --yes', 'Skip prompts and use default values')
			.option('-n, --name <name>', 'Project name')
			.option('-d, --description <description>', 'Project description')
			.option('-v, --version <version>', 'Project version', '0.1.0')
			.option('-a, --author <author>', 'Author name')
			.option(
				'-r, --rules <rules...>',
				'Rule profiles to install (claude). Accepts comma or space separated values.'
			)
			.option('--claude', 'Set up Claude Code integration (the default)')
			.option(
				'--no-claude',
				'Skip the Claude Code integration (CLAUDE.md import)'
			)
			.option(
				'--mcp',
				'Also register the TaskGraph MCP server in .mcp.json (Claude Code)'
			)
			.option('--skip-install', 'Skip installing dependencies')
			.option('--dry-run', 'Show what would be done without making changes')
			.option('--aliases', 'Add the tm alias to your shell startup file')
			.option('--no-aliases', "Don't add the tm alias, and don't ask")
			.option('--git', 'Initialize Git repository')
			.option('--no-git', 'Skip Git repository initialization')
			.option('--git-tasks', 'Store tasks in Git')
			.option('--no-git-tasks', 'No Git storage of tasks')
			.option(
				'--merge-driver',
				'Only set up Git to merge tasks.json by task (existing projects)'
			)
			.option(
				UPSTREAM_IMPORT_FLAG,
				`Import a ${UPSTREAM_NAME} project (${UPSTREAM_DIR}/)`
			)
			.action(async (options: InitCommandOptions) => {
				try {
					await this.executeCommand(options);
				} catch (error) {
					// displayError exits 1; only Ctrl-C at a prompt gets here
					if (!(error instanceof InitCancelled)) return displayError(error);
					console.log(theme.muted('\nCancelled; nothing changed'));
					process.exitCode = 130;
				}
			});
	}

	private async executeCommand(options: InitCommandOptions): Promise<void> {
		if (options.mergeDriver) {
			this.setUpMergeDriverOnly();
			return;
		}

		// Space or comma separated; only claude is supported
		const rules = (options.rules ?? [])
			.flatMap((rule) => rule.split(','))
			.map((rule) => rule.trim())
			.filter(Boolean);
		const invalid = findInvalidRulesProfiles(rules);
		if (invalid.length > 0) {
			printError(
				`"${terminalSafe(invalid.join(', '))}" isn't a rule profile`,
				`TaskGraph supports Claude Code only; use \`--rules ${RULE_PROFILES.join(',')}\``
			);
			process.exit(1);
		}
		if (options.mcp && options.claude === false) {
			printError(
				'--mcp writes Claude Code’s .mcp.json, so it needs the Claude Code integration',
				'Drop --no-claude, or drop --mcp'
			);
			process.exit(1);
		}

		const projectRoot = process.cwd();
		const importUpstream = Boolean(options[UPSTREAM_IMPORT_OPTION]);
		if (importUpstream) {
			try {
				checkUpstreamImport(projectRoot);
			} catch (error) {
				if (!(error instanceof UpstreamImportError)) throw error;
				printError(error.message, error.hint);
				process.exit(1);
			}
		}

		const skipPrompts = Boolean(
			options.yes || (options.name && options.description)
		);
		if (!skipPrompts && !(process.stdin.isTTY && process.stdout.isTTY)) {
			printError(
				'init needs a terminal to ask its questions',
				'Run `taskgraph init --yes`; flags such as `--no-git-tasks` or `--no-claude` change its defaults'
			);
			process.exit(1);
		}

		displayInitBanner();

		// Claude Code is on unless --no-claude: --yes and the prompt's default
		// both set it up. --claude, --no-claude or --rules answer the prompt.
		const claudeAnswered = options.claude !== undefined || rules.length > 0;
		const answers: InitAnswers = skipPrompts
			? {
					initGit: options.git ?? true,
					// No flag: keep what an earlier init chose, else store tasks in Git
					storeTasksInGit: resolveStoreTasksInGit(
						projectRoot,
						options.gitTasks
					),
					claudeCode: options.claude !== false,
					responseLanguage: 'English',
					// The shell startup file is outside the project: only --aliases
					aliases: options.aliases === true
				}
			: await askInitQuestions(options, claudeAnswered);

		if (options.dryRun) {
			const plan = planInit(projectRoot, answers);
			console.log(
				formatInitDryRun({
					importFrom: importUpstream ? UPSTREAM_DIR : undefined,
					startGit: plan.startGit,
					mergeDriver: plan.mergeDriver,
					storeTasksInGit: answers.storeTasksInGit,
					aliasFile: plan.aliasFile && displayPath(plan.aliasFile),
					claudeCode: answers.claudeCode,
					mcp: options.mcp === true
				})
			);
			return;
		}

		// Each problem prints as it happens, so a later step that throws
		// doesn't hide the warnings before it
		const result = initializeProject({
			projectRoot,
			...answers,
			mcp: options.mcp === true,
			importUpstream,
			onProblem: printInitProblem
		});

		// The errors printed as they happened; a summary would read as success
		if (result.failed) {
			printError(
				"Init didn't finish; see the errors above",
				'Fix the cause and run `taskgraph init` again; it keeps what is already set up'
			);
			process.exitCode = 1;
			return;
		}

		// Interactive runs choose models now; --yes keeps the defaults, which
		// the summary mentions. An import brings its models.
		if (!options.yes && !result.imported) {
			console.log('');
			try {
				// This same CLI rather than `npx taskgraph`, which can resolve to
				// a different npm package when TaskGraph isn't installed locally
				execFileSync(
					process.execPath,
					[process.argv[1], 'models', '--setup', '--no-banner'],
					{ stdio: 'inherit', cwd: projectRoot }
				);
				console.log('');
			} catch {
				console.warn(
					chalk.yellow('!'),
					chalk.yellow(
						'Model setup did not finish; run `taskgraph models --setup` to retry'
					)
				);
			}
		}

		if (result.imported) {
			console.log(
				`${formatUpstreamImport({
					result: result.imported,
					changes: [...result.changes, ...result.hints].filter(
						(change) => change.path !== '.taskgraph/'
					)
				})}\n`
			);
			return;
		}
		console.log(
			`${formatInitSummary({
				folder: terminalSafe(path.basename(projectRoot)),
				changes: result.changes,
				hints: result.hints,
				alreadySetUp: result.alreadySetUp,
				claudeCode: answers.claudeCode,
				defaultModels: Boolean(options.yes)
			})}\n`
		);
	}

	private setUpMergeDriverOnly(): void {
		const root = findProjectRoot() || process.cwd();
		try {
			console.log(formatMergeDriverSetup(setUpMergeDriver(root)));
		} catch (error) {
			if ((error as Error)?.name === 'NotAGitRepositoryError') {
				printError(
					"This folder isn't in a Git repository",
					'Run `git init` first, then `taskgraph init --merge-driver`'
				);
			} else {
				printError(
					`Couldn't set up the tasks.json merge driver: ${terminalSafe((error as Error).message)}`
				);
			}
			process.exit(1);
		}
	}
}

/**
 * Ask what flags didn't answer. Each answer replaces its prompt with one
 * line, so nothing needs confirming at the end.
 * @throws {InitCancelled} On Ctrl-C
 */
async function askInitQuestions(
	options: InitCommandOptions,
	claudeAnswered: boolean
): Promise<InitAnswers> {
	const { default: inquirer } = await import('inquirer');
	const ask = inquirer.createPromptModule({ clearPromptOnDone: true });
	const cancellable = async <T>(pending: Promise<T>): Promise<T> => {
		try {
			return await pending;
		} catch (error) {
			if ((error as Error)?.name === 'ExitPromptError') {
				throw new InitCancelled();
			}
			throw error;
		}
	};
	const confirm = async (
		question: string,
		shown: string,
		defaultYes: boolean
	): Promise<boolean> => {
		const { answer } = await cancellable(
			ask<{ answer: boolean }>([
				{
					type: 'confirm',
					name: 'answer',
					message: question,
					default: defaultYes
				}
			])
		);
		console.log(answerLine(shown, answer));
		return answer;
	};

	// Nothing to ask when there's already a repository: init won't run git init
	const initGit =
		options.git ??
		(insideGitWorkTree() ||
			(await confirm(
				'Initialize a Git repository in project root?',
				'Initialize a Git repository in project root?',
				true
			)));
	const storeTasksInGit =
		options.gitTasks ??
		(await confirm(
			'Store tasks in Git (tasks.json and tasks/ directory)?',
			'Store tasks in Git (tasks.json and tasks/ directory)?',
			true
		));
	const claudeCode = claudeAnswered
		? options.claude !== false
		: await confirm(
				'Set up Claude Code integration (CLAUDE.md import)?',
				'Set up Claude Code integration?',
				true
			);

	const { language } = await cancellable(
		ask<{ language: string }>([
			{
				type: 'input',
				name: 'language',
				message: 'Language for AI responses',
				default: 'English'
			}
		])
	);
	const responseLanguage = language.trim() || 'English';
	console.log(
		`${theme.brand('Language for AI responses?')} ${chalk.dim(terminalSafe(responseLanguage))}`
	);

	// The shell startup file is outside the project, so ask first, with No
	// as the default, unless --aliases or --no-aliases answered
	let aliases = options.aliases === true;
	const rcFile = options.aliases === undefined ? aliasMissingFile() : null;
	if (rcFile) {
		const shown = terminalSafe(displayPath(rcFile));
		aliases = await confirm(
			`Add a tm alias for taskgraph to ${shown}?`,
			`Add a tm alias to ${shown}?`,
			false
		);
	}

	return { initGit, storeTasksInGit, claudeCode, responseLanguage, aliases };
}
