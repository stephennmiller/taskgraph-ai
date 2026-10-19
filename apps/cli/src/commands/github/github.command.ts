/**
 * @fileoverview Github command - push tasks to GitHub Issues
 * Thin presentation layer over tmCore.github
 */

import path from 'node:path';
import { type PushOptions, type TmCore, createTmCore } from '@tm/core';
import { Command } from 'commander';
import inquirer from 'inquirer';
import { displayError } from '../../utils/error-handler.js';
import { getProjectRoot } from '../../utils/project-root.js';
import {
	formatPlan,
	formatResult,
	formatStatus,
	formatUnlink,
	hasWrites
} from './github-format.js';

interface CommonOptions {
	project?: string;
	json?: boolean;
}

interface StatusOptions extends CommonOptions {
	repo?: string;
}

interface PushCommandOptions extends CommonOptions {
	tag?: string;
	allTags?: boolean;
	id?: string;
	dryRun?: boolean;
	yes?: boolean;
	repo?: string;
	includeDetails?: boolean;
	closeOrphans?: boolean;
}

interface UnlinkOptions extends CommonOptions {
	tag?: string;
}

export class GithubCommand extends Command {
	private tmCore?: TmCore;

	constructor(name?: string) {
		super(name || 'github');

		this.description('Push tasks to GitHub Issues (one way)');
		this.addStatusCommand();
		this.addPushCommand();
		this.addUnlinkCommand();
	}

	private addStatusCommand(): void {
		this.command('status')
			.description('Show gh availability, target repo and linked task counts')
			.option('--repo <owner/name>', 'Repository to check')
			.option('-p, --project <path>', 'Project root directory')
			.option('--json', 'Output as JSON')
			.action((options: StatusOptions) =>
				this.guard(options, () => this.runStatus(options))
			);
	}

	private addPushCommand(): void {
		this.command('push')
			.description('Create or update GitHub issues for tasks')
			.option('--tag <name>', 'Tag to push (default: the active tag)')
			.option('--all-tags', 'Push every tag')
			.option('--id <ids>', 'Only push these task ids, comma separated')
			.option('--dry-run', 'Show the plan without writing anything')
			.option('-y, --yes', 'Write without asking for confirmation')
			.option('--repo <owner/name>', 'Repository (default: detected via gh)')
			.option('--include-details', 'Include task details in issue bodies')
			.option('--close-orphans', 'Close open issues whose task is gone')
			.option('-p, --project <path>', 'Project root directory')
			.option('--json', 'Output as JSON (requires --yes or --dry-run)')
			.addHelpText(
				'after',
				`
Examples:
  $ taskgraph github push --dry-run      # Preview the active tag
  $ taskgraph github push --all-tags -y  # Push every tag without asking
  $ taskgraph github push --id 1,2       # Push only tasks 1 and 2
`
			)
			.action((options: PushCommandOptions) =>
				this.guard(options, () => this.runPush(options))
			);
	}

	private addUnlinkCommand(): void {
		this.command('unlink')
			.description('Forget the GitHub issue a task is linked to')
			.argument('<id>', 'Task id')
			.option('--tag <name>', 'Tag the task lives in')
			.option('-p, --project <path>', 'Project root directory')
			.option('--json', 'Output as JSON')
			.action((id: string, options: UnlinkOptions) =>
				this.guard(options, () => this.runUnlink(id, options))
			);
	}

	/** Run an action, report errors, exit non-zero on failure */
	private async guard(
		options: CommonOptions,
		action: () => Promise<void>
	): Promise<void> {
		let failed = false;
		try {
			await this.initializeCore(options);
			await action();
		} catch (error) {
			failed = true;
			displayError(error, { skipExit: true });
		} finally {
			await this.tmCore?.close();
		}
		if (failed) process.exit(1);
	}

	private async initializeCore(options: CommonOptions): Promise<void> {
		if (!this.tmCore) {
			const root = path.resolve(getProjectRoot(options.project));
			this.tmCore = await createTmCore({ projectPath: root });
		}
	}

	private core(): TmCore {
		if (!this.tmCore) throw new Error('TmCore not initialized');
		return this.tmCore;
	}

	private async runStatus(options: StatusOptions): Promise<void> {
		const status = await this.core().github.status({ repo: options.repo });
		console.log(
			options.json ? JSON.stringify(status, null, 2) : formatStatus(status)
		);
	}

	private async runPush(options: PushCommandOptions): Promise<void> {
		if (options.tag && options.allTags) {
			throw new Error('Use either --tag or --all-tags, not both');
		}
		const core = this.core();
		const pushOptions: PushOptions = {
			repo: options.repo,
			tag: options.allTags
				? undefined
				: (options.tag ?? core.config.getActiveTag()),
			taskIds: options.id
				?.split(',')
				.map((id) => id.trim())
				.filter(Boolean),
			includeDetails: options.includeDetails,
			closeOrphans: options.closeOrphans
		};

		if (options.dryRun) {
			const result = await core.github.push({ ...pushOptions, dryRun: true });
			this.print(options, result, [
				formatPlan(result.plan),
				formatResult(result)
			]);
			return;
		}

		const plan = await core.github.planPush(pushOptions);
		if (!hasWrites(plan)) {
			const result = await core.github.push({ ...pushOptions, dryRun: true });
			this.print(options, { ...result, dryRun: false }, [
				formatPlan(plan),
				'GitHub is already up to date.'
			]);
			return;
		}

		if (!options.yes) {
			if (options.json || !this.isInteractive()) {
				throw new Error(
					'Refusing to write to GitHub without confirmation. Pass --yes to proceed or --dry-run to preview.'
				);
			}
			console.log(formatPlan(plan));
			if (!(await this.confirm(plan.repo))) {
				console.log('Cancelled. Nothing was written.');
				return;
			}
		}

		const result = await core.github.push({ ...pushOptions, dryRun: false });
		this.print(options, result, [
			...(options.yes ? [formatPlan(result.plan)] : []),
			formatResult(result)
		]);
	}

	private async runUnlink(id: string, options: UnlinkOptions): Promise<void> {
		const result = await this.core().github.unlink(id, { tag: options.tag });
		console.log(
			options.json ? JSON.stringify(result, null, 2) : formatUnlink(result)
		);
	}

	private print(options: CommonOptions, json: unknown, text: string[]): void {
		console.log(
			options.json ? JSON.stringify(json, null, 2) : text.join('\n\n')
		);
	}

	/** Can we prompt? Overridable for tests */
	protected isInteractive(): boolean {
		return Boolean(process.stdin.isTTY && process.stdout.isTTY);
	}

	protected async confirm(repo: string): Promise<boolean> {
		const { proceed } = await inquirer.prompt<{ proceed: boolean }>([
			{
				type: 'confirm',
				name: 'proceed',
				message: `Write these changes to ${repo}?`,
				default: false
			}
		]);
		return proceed;
	}
}
