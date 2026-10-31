/**
 * @fileoverview Loop command - thin CLI wrapper over @tm/core's LoopDomain
 */

import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import {
	type LoopConfig,
	type LoopIteration,
	type LoopOutputCallbacks,
	type LoopResult,
	type LoopTask,
	DEFAULT_CONTAINER_IMAGE,
	MAX_PARALLEL,
	PRESET_NAMES,
	type ParallelTask,
	type TmCore,
	assertContainerFlags,
	assertParallelFlags,
	createTmCore,
	parseLoopCaps,
	parseParallelCount
} from '@tm/core';
import chalk from 'chalk';
import { Command } from 'commander';
import { formatLoopIntro } from '../ui/formatters/loop-formatters.js';
import { terminalSafe } from '../ui/formatters/markdown-formatters.js';
import { formatLoopSpend } from '../ui/formatters/usage-formatters.js';
import { displayCommandHeader } from '../utils/display-helpers.js';
import { displayError } from '../utils/error-handler.js';
import {
	formatParallelHeader,
	formatParallelSummary,
	formatParallelTaskLines
} from '../ui/formatters/parallel-loop-formatters.js';
import { terminalWidth } from '../ui/layout/helpers.js';
import { getProjectRoot } from '../utils/project-root.js';

export interface LoopCommandOptions {
	iterations?: string;
	id?: string;
	prompt?: string;
	progressFile?: string;
	tag?: string;
	project?: string;
	sandbox?: boolean;
	trust?: boolean;
	output?: boolean;
	verbose?: boolean;
	parallel?: string;
	container?: boolean;
	containerImage?: string;
	maxTurns?: string;
	maxBudgetUsd?: string;
}

export class LoopCommand extends Command {
	private tmCore!: TmCore;

	constructor(name?: string) {
		super(name || 'loop');

		this.description('Run Claude Code in a loop, one task per iteration')
			.option('-n, --iterations <number>', 'Maximum iterations')
			.option(
				'-i, --id <id>',
				'Work on this task or subtask instead of the next one (1 iteration unless -n is given)'
			)
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
				"Hide Claude's output; show only each iteration's status"
			)
			.option('-v, --verbose', "Show Claude's work in real-time")
			.option(
				'--max-turns <n>',
				"Stop each Claude Code run after n turns (claude's --max-turns)"
			)
			.option(
				'--max-budget-usd <amount>',
				'Stop the run once it has spent this many US dollars; each Claude Code run gets what is left'
			)
			.option(
				'--parallel <n>',
				`Run up to n ready tasks at once (1-${MAX_PARALLEL}), each in its own git worktree and branch`
			)
			.option(
				'--container',
				'With --parallel: run each task in its own Docker container (needs CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY)'
			)
			.option(
				'--container-image <image>',
				`Image for --container (default: ${DEFAULT_CONTAINER_IMAGE})`
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
			assertContainerFlags(options);
			const caps = parseLoopCaps(options);
			const projectRoot = path.resolve(getProjectRoot(options.project));
			this.tmCore = await createTmCore({ projectPath: projectRoot });

			// Check --id before anything else, so a typo costs nothing
			const pinned: LoopTask | undefined =
				options.id !== undefined
					? await this.tmCore.loop.resolveTask(options.id, {
							prompt,
							tag: options.tag
						})
					: undefined;

			// Pending count (tasks + subtasks) caps a run of a preset that works on tasks
			const pendingTaskCount =
				this.tmCore.loop.isTaskPreset(prompt) && !pinned
					? await this.tmCore.tasks.getCount('pending', options.tag)
					: undefined;

			// Delegate iteration resolution logic to tm-core
			const iterations = this.tmCore.loop.resolveIterations({
				userIterations: options.iterations
					? parseInt(options.iterations, 10)
					: undefined,
				preset: prompt,
				taskId: pinned?.id,
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

			// The task the run starts on, for presets that work on tasks
			let next: LoopTask | null | undefined;
			if (!pinned && this.tmCore.loop.isTaskPreset(prompt)) {
				const task = await this.tmCore.tasks.getNext(options.tag);
				next = task ? { id: String(task.id), title: task.title } : null;
			}
			for (const line of formatLoopIntro(
				{
					prompt,
					isPreset: this.tmCore.loop.isPreset(prompt),
					iterations,
					sandbox: options.sandbox ?? false,
					pinned,
					next
				},
				terminalWidth()
			)) {
				console.log(line);
			}

			const config: Partial<LoopConfig> = {
				iterations,
				prompt,
				progressFile,
				tag: options.tag,
				taskId: pinned?.id,
				sandbox: options.sandbox,
				trusted: options.trust,
				verbose: options.verbose ?? false,
				...caps,
				callbacks: this.createOutputCallbacks(options.output ?? true)
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
				verbose: options.verbose,
				taskId: options.id
			});
			assertContainerFlags(options);
			const caps = parseLoopCaps(options);

			const projectRoot = path.resolve(getProjectRoot(options.project));
			this.tmCore = await createTmCore({ projectPath: projectRoot });
			const container = options.container
				? { image: options.containerImage }
				: undefined;
			// Before asking for approval: a missing token or Docker stops here
			if (container) await this.tmCore.loop.checkContainer(container);
			if (!options.trust) await this.confirmTrust(parallel);

			const logsDir = '.taskgraph/worktrees';
			const tasks: ParallelTask[] = [];
			const lines = () =>
				formatParallelTaskLines(tasks, { width: terminalWidth() });
			const render = () =>
				live?.render([
					formatParallelHeader(tasks.length, logsDir, terminalWidth()),
					...lines()
				]);
			const upsert = (task: ParallelTask) => {
				const i = tasks.findIndex((t) => t.id === task.id);
				if (i === -1) tasks.push(task);
				else tasks[i] = task;
			};

			// Closing the terminal or a kill stops the tasks too: Claude runs in
			// its own process group and wouldn't get the signal
			for (const sig of STOP_SIGNALS) process.on(sig, onSigint);
			if (live) timer = setInterval(render, 1000);
			const result = await this.tmCore.loop.runParallel({
				parallel,
				tag: options.tag,
				trusted: true,
				container,
				...caps,
				signal: controller.signal,
				callbacks: {
					onTaskStart: (task) => {
						if (!live && tasks.length === 0) {
							console.log(
								formatParallelHeader(undefined, logsDir, terminalWidth())
							);
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
					parallel,
					container
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
			for (const sig of STOP_SIGNALS) process.off(sig, onSigint);
		}
	}

	/**
	 * First run in a project: `loop` turns Claude's permission prompts off.
	 * With --parallel there's no sandbox to suggest instead.
	 */
	private async confirmTrust(parallel?: number): Promise<void> {
		if (this.tmCore.loop.isTrusted()) return;
		const who =
			parallel === undefined
				? 'Claude'
				: `up to ${parallel} Claude Code processes at once,`;
		const instead =
			parallel === undefined ? ', or --sandbox to run in Docker' : '';
		if (!process.stdin.isTTY || !process.stdout.isTTY) {
			throw new Error(
				`loop runs ${who} with permission prompts off. Pass --trust to allow that here${instead}.`
			);
		}
		const { default: inquirer } = await import('inquirer');
		const { confirmed } = await inquirer.prompt([
			{
				type: 'confirm',
				name: 'confirmed',
				message: `loop runs ${who} with permission prompts off: ${parallel === undefined ? 'it' : 'each'} can read, edit and run anything in this project without asking. Allow that here?`,
				default: false
			}
		]);
		if (!confirmed)
			throw new Error(
				parallel === undefined
					? 'Not approved. Use --sandbox to run in Docker.'
					: 'Not approved; no tasks were claimed.'
			);
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

	private createOutputCallbacks(showOutput: boolean): LoopOutputCallbacks {
		return {
			onIterationStart: (iteration: number, total: number) => {
				console.log();
				console.log(chalk.cyan(`━━━ Iteration ${iteration} of ${total} ━━━`));
			},
			// --no-output: Claude's text and tool calls aren't printed
			...(showOutput && {
				onText: (text: string) => console.log(text),
				onToolUse: (toolName: string) =>
					console.log(chalk.dim(`  → ${toolName}`)),
				onOutput: (output: string) => console.log(output)
			}),
			// Messages can name a task ID read from tasks.json
			onError: (raw: string, severity?: 'warning' | 'error') => {
				const message = terminalSafe(raw);
				if (severity === 'warning') {
					console.error(chalk.yellow(`[Loop Warning] ${message}`));
				} else {
					console.error(chalk.red(`[Loop Error] ${message}`));
				}
			},
			onStderr: (iteration: number, text: string) => {
				process.stderr.write(chalk.dim(`[Iteration ${iteration}] `) + text);
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
					) +
						formatLoopSpend({
							costUsd: iteration.costUsd,
							turns: iteration.turns,
							durationMs: iteration.duration
						})
				);
			}
		};
	}

	private displayResult(result: LoopResult): void {
		console.log();
		console.log(chalk.bold('Loop Complete'));
		console.log(chalk.dim('─'.repeat(40)));
		console.log(
			`Total iterations: ${result.totalIterations}` +
				formatLoopSpend({
					costUsd: result.totalCostUsd,
					turns: result.totalTurns
				})
		);
		console.log(`Tasks completed: ${result.tasksCompleted}`);
		console.log(`Final status: ${this.formatStatus(result.finalStatus)}`);
		if (result.errorMessage) {
			console.log(chalk.red(`Error: ${terminalSafe(result.errorMessage)}`));
		}
	}

	private formatStatus(status: LoopResult['finalStatus']): string {
		const statusMap: Record<LoopResult['finalStatus'], string> = {
			all_complete: chalk.green('All tasks complete'),
			max_iterations: chalk.yellow('Max iterations reached'),
			budget_reached: chalk.yellow('Budget reached (--max-budget-usd)'),
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

/** Signals that stop a parallel run the way Ctrl-C does */
const STOP_SIGNALS: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];

/** A block of lines redrawn in place on a terminal */
class LiveLines {
	private drawn = 0;

	render(lines: string[]): void {
		let out = this.drawn ? `\x1b[${this.drawn}A\x1b[J` : '';
		for (const line of lines) out += `\x1b[2K${line}\n`;
		process.stdout.write(out);
		// Count rows, not lines: a line wider than the terminal wraps
		const columns = process.stdout.columns || 80;
		this.drawn = lines.reduce(
			(rows, line) =>
				rows +
				Math.max(1, Math.ceil(stripVTControlCharacters(line).length / columns)),
			0
		);
	}
}
