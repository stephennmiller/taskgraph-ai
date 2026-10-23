/**
 * @fileoverview Loop command - thin CLI wrapper over @tm/core's LoopDomain
 */

import path from 'node:path';
import {
	type LoopConfig,
	type LoopIteration,
	type LoopOutputCallbacks,
	type LoopResult,
	MAX_PARALLEL,
	PRESET_NAMES,
	type ParallelTask,
	type TmCore,
	assertParallelFlags,
	createTmCore,
	parseParallelCount
} from '@tm/core';
import chalk from 'chalk';
import { Command } from 'commander';
import inquirer from 'inquirer';
import { displayCommandHeader } from '../utils/display-helpers.js';
import { displayError } from '../utils/error-handler.js';
import {
	formatParallelHeader,
	formatParallelSummary,
	formatParallelTaskLines
} from '../ui/formatters/parallel-loop-formatters.js';
import { terminalWidth } from '../ui/layout/helpers.js';
import { theme } from '../ui/theme.js';
import { getProjectRoot } from '../utils/project-root.js';

export interface LoopCommandOptions {
	iterations?: string;
	prompt?: string;
	progressFile?: string;
	tag?: string;
	project?: string;
	sandbox?: boolean;
	trust?: boolean;
	output?: boolean;
	verbose?: boolean;
	parallel?: string;
}

export class LoopCommand extends Command {
	private tmCore!: TmCore;

	constructor(name?: string) {
		super(name || 'loop');

		this.description('Run Claude Code in a loop, one task per iteration')
			.option('-n, --iterations <number>', 'Maximum iterations')
			.option(
				'-p, --prompt <preset|path>',
				`Preset name (${PRESET_NAMES.join(', ')}) or path to custom prompt file`,
				'default'
			)
			.option(
				'--progress-file <path>',
				'Path to progress log file',
				'.taskgraph/progress.txt'
			)
			.option('-t, --tag <tag>', 'Only work on tasks with this tag')
			.option(
				'--project <path>',
				'Project root directory (auto-detected if not provided)'
			)
			.option('--sandbox', 'Run Claude in Docker sandbox mode')
			.option(
				'--trust',
				'Run Claude without permission prompts in this project, without asking first (for scripts)'
			)
			.option(
				'--no-output',
				'Exclude full Claude output from iteration results'
			)
			.option('-v, --verbose', "Show Claude's work in real-time")
			.option(
				'--parallel <n>',
				`Run up to n ready tasks at once (1-${MAX_PARALLEL}), each in its own git worktree and branch`
			)
			.action((options: LoopCommandOptions) => this.execute(options));
	}

	private async execute(options: LoopCommandOptions): Promise<void> {
		if (options.parallel !== undefined) {
			return this.executeParallel(options);
		}
		const prompt = options.prompt || 'default';
		const progressFile = options.progressFile || '.taskgraph/progress.txt';

		try {
			const projectRoot = path.resolve(getProjectRoot(options.project));
			this.tmCore = await createTmCore({ projectPath: projectRoot });

			// Get pending task count for default preset iteration resolution
			const pendingTaskCount =
				prompt === 'default'
					? await this.tmCore.tasks.getCount('pending', options.tag)
					: undefined;

			// Delegate iteration resolution logic to tm-core
			const iterations = this.tmCore.loop.resolveIterations({
				userIterations: options.iterations
					? parseInt(options.iterations, 10)
					: undefined,
				preset: prompt,
				pendingTaskCount
			});

			this.validateIterations(String(iterations));

			displayCommandHeader({
				tag: options.tag || this.tmCore.config.getActiveTag(),
				projectRoot: this.tmCore.projectPath
			});

			// Only check sandbox auth when --sandbox flag is used
			if (options.sandbox) {
				this.handleSandboxAuth();
			}

			if (!options.sandbox && !options.trust) {
				await this.confirmTrust();
			}

			console.log(chalk.cyan('Starting TaskGraph Loop...'));
			console.log(chalk.dim(`Preset: ${prompt}`));
			console.log(chalk.dim(`Max iterations: ${iterations}`));
			console.log(
				chalk.dim(`Mode: ${options.sandbox ? 'Docker sandbox' : 'Claude CLI'}`)
			);

			// Show next task only for default preset (other presets don't use TaskGraph tasks)
			if (prompt === 'default') {
				const nextTask = await this.tmCore.tasks.getNext(options.tag);
				if (nextTask) {
					console.log(
						theme.text(
							`Next task to work on: ${theme.text(nextTask.id)} - ${nextTask.title}`
						)
					);
				} else {
					console.log(chalk.yellow('No pending tasks found'));
				}
			}
			console.log();

			const config: Partial<LoopConfig> = {
				iterations,
				prompt,
				progressFile,
				tag: options.tag,
				sandbox: options.sandbox,
				trusted: options.trust,
				// CLI defaults to including output (users typically want to see it)
				// Domain defaults to false (library consumers opt-in explicitly)
				includeOutput: options.output ?? true,
				verbose: options.verbose ?? false,
				callbacks: this.createOutputCallbacks()
			};

			const result = await this.tmCore.loop.run(config);
			this.displayResult(result);
			// Scripts and CI read the exit code; a stuck or failed loop is a failure
			if (result.finalStatus === 'error' || result.finalStatus === 'blocked') {
				process.exitCode = 1;
			}
		} catch (error: unknown) {
			displayError(error, { skipExit: true });
			process.exit(1);
		}
	}

	/**
	 * `--parallel <n>`: tm-core claims wave-1 tasks and runs one Claude Code
	 * process per worktree; this only shows the status lines and summary.
	 */
	private async executeParallel(options: LoopCommandOptions): Promise<void> {
		const controller = new AbortController();
		let interrupts = 0;
		const onSigint = () => {
			interrupts++;
			// A second Ctrl-C leaves at once, without the cleanup
			if (interrupts > 1) process.exit(130);
			controller.abort();
		};
		const live = process.stdout.isTTY ? new LiveLines() : null;
		let timer: NodeJS.Timeout | undefined;

		try {
			const parallel = parseParallelCount(options.parallel ?? '');
			assertParallelFlags({
				prompt: options.prompt,
				iterations:
					options.iterations !== undefined
						? Number(options.iterations)
						: undefined,
				sandbox: options.sandbox,
				verbose: options.verbose
			});

			const projectRoot = path.resolve(getProjectRoot(options.project));
			this.tmCore = await createTmCore({ projectPath: projectRoot });
			if (!options.trust) await this.confirmTrust();

			const logsDir = '.taskgraph/worktrees';
			const tasks: ParallelTask[] = [];
			const lines = () =>
				formatParallelTaskLines(tasks, { width: terminalWidth() });
			const render = () =>
				live?.render([formatParallelHeader(tasks.length, logsDir), ...lines()]);
			const upsert = (task: ParallelTask) => {
				const i = tasks.findIndex((t) => t.id === task.id);
				if (i === -1) tasks.push(task);
				else tasks[i] = task;
			};

			process.on('SIGINT', onSigint);
			if (live) timer = setInterval(render, 1000);
			const result = await this.tmCore.loop.runParallel({
				parallel,
				tag: options.tag,
				trusted: true,
				signal: controller.signal,
				callbacks: {
					onTaskStart: (task) => {
						if (!live && tasks.length === 0) {
							console.log(formatParallelHeader(undefined, logsDir));
						}
						upsert(task);
						if (live) render();
						else console.log(lines()[tasks.length - 1]);
					},
					onTaskEnd: (task) => {
						upsert(task);
						if (live) render();
						else console.log(lines()[tasks.findIndex((t) => t.id === task.id)]);
					}
				}
			});
			clearInterval(timer);
			if (tasks.length) console.log();
			console.log(
				formatParallelSummary(result, {
					projectRoot: this.tmCore.projectPath,
					parallel
				})
			);
			if (result.aborted) process.exitCode = 130;
			else if (result.tasks.some((t) => t.state === 'failed')) {
				process.exitCode = 1;
			}
		} catch (error: unknown) {
			displayError(error, { skipExit: true });
			process.exitCode = 1;
		} finally {
			clearInterval(timer);
			process.off('SIGINT', onSigint);
		}
	}

	/** First run in a project: `loop` turns Claude's permission prompts off */
	private async confirmTrust(): Promise<void> {
		if (this.tmCore.loop.isTrusted()) return;
		if (!process.stdin.isTTY || !process.stdout.isTTY) {
			throw new Error(
				'loop runs Claude with permission prompts off. Pass --trust to allow that here, or --sandbox to run in Docker.'
			);
		}
		const { confirmed } = await inquirer.prompt([
			{
				type: 'confirm',
				name: 'confirmed',
				message:
					'loop runs Claude with permission prompts off: it can read, edit and run anything in this project without asking. Allow that here?',
				default: false
			}
		]);
		if (!confirmed)
			throw new Error('Not approved. Use --sandbox to run in Docker.');
		this.tmCore.loop.trust();
	}

	private handleSandboxAuth(): void {
		console.log(chalk.dim('Checking sandbox auth...'));
		const authCheck = this.tmCore.loop.checkSandboxAuth();

		if (authCheck.error) {
			throw new Error(authCheck.error);
		}

		if (authCheck.ready) {
			console.log(chalk.green('✓ Sandbox ready'));
			return;
		}

		console.log(
			chalk.yellow(
				'Sandbox needs authentication. Starting interactive session...'
			)
		);
		console.log(chalk.dim('Please complete auth, then Ctrl+C to continue.\n'));

		const authResult = this.tmCore.loop.runInteractiveAuth();
		if (!authResult.success) {
			throw new Error(authResult.error || 'Interactive authentication failed');
		}
		console.log(chalk.green('✓ Auth complete\n'));
	}

	private validateIterations(iterations: string): void {
		const parsed = Number(iterations);
		if (!Number.isInteger(parsed) || parsed < 1) {
			throw new Error(
				`Invalid iterations: ${iterations}. Must be a positive integer.`
			);
		}
	}

	private createOutputCallbacks(): LoopOutputCallbacks {
		return {
			onIterationStart: (iteration: number, total: number) => {
				console.log();
				console.log(chalk.cyan(`━━━ Iteration ${iteration} of ${total} ━━━`));
			},
			onText: (text: string) => {
				console.log(text);
			},
			onToolUse: (toolName: string) => {
				console.log(chalk.dim(`  → ${toolName}`));
			},
			onError: (message: string, severity?: 'warning' | 'error') => {
				if (severity === 'warning') {
					console.error(chalk.yellow(`[Loop Warning] ${message}`));
				} else {
					console.error(chalk.red(`[Loop Error] ${message}`));
				}
			},
			onStderr: (iteration: number, text: string) => {
				process.stderr.write(chalk.dim(`[Iteration ${iteration}] `) + text);
			},
			onOutput: (output: string) => {
				console.log(output);
			},
			onIterationEnd: (iteration: LoopIteration) => {
				const statusColor =
					iteration.status === 'success'
						? chalk.green
						: iteration.status === 'error'
							? chalk.red
							: chalk.yellow;
				console.log(
					statusColor(
						`  Iteration ${iteration.iteration} completed: ${iteration.status}`
					)
				);
			}
		};
	}

	private displayResult(result: LoopResult): void {
		console.log();
		console.log(chalk.bold('Loop Complete'));
		console.log(chalk.dim('─'.repeat(40)));
		console.log(`Total iterations: ${result.totalIterations}`);
		console.log(`Tasks completed: ${result.tasksCompleted}`);
		console.log(`Final status: ${this.formatStatus(result.finalStatus)}`);
		if (result.errorMessage) {
			console.log(chalk.red(`Error: ${result.errorMessage}`));
		}
	}

	private formatStatus(status: LoopResult['finalStatus']): string {
		const statusMap: Record<LoopResult['finalStatus'], string> = {
			all_complete: chalk.green('All tasks complete'),
			max_iterations: chalk.yellow('Max iterations reached'),
			blocked: chalk.red('Blocked'),
			error: chalk.red('Error')
		};
		return statusMap[status];
	}

	static register(program: Command, name?: string): LoopCommand {
		const cmd = new LoopCommand(name);
		program.addCommand(cmd);
		return cmd;
	}
}

/** A block of lines redrawn in place on a terminal */
class LiveLines {
	private drawn = 0;

	render(lines: string[]): void {
		let out = this.drawn ? `\x1b[${this.drawn}A` : '';
		for (const line of lines) out += `\x1b[2K${line}\n`;
		process.stdout.write(out);
		this.drawn = lines.length;
	}
}
