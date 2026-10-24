/**
 * @fileoverview Tags Command - Manage task organization with tags
 * Provides tag management for the local tasks file
 */

import type { TmCore } from '@tm/core';
import { createTmCore, getProjectPaths } from '@tm/core';
import chalk from 'chalk';
import { Command } from 'commander';
import {
	formatTagCopied,
	formatTagCreated,
	formatTagDeleted,
	formatTagList,
	formatTagRenamed,
	formatTagSwitched,
	terminalSafe
} from '../ui/index.js';
import { theme } from '../ui/theme.js';
import { displayError, fromBranchError } from '../utils/index.js';
import { printJson } from '../utils/json-output.js';

/**
 * Result type from tags command
 */
export interface TagsResult {
	success: boolean;
	action: 'list' | 'add' | 'use' | 'remove' | 'rename' | 'copy';
	tags?: any[];
	currentTag?: string | null;
	message?: string;
}

/**
 * An Error carrying the next step; the CLI error display prints it as a hint.
 */
function withHint(message: string, hint: string): Error {
	return Object.assign(new Error(message), { hint });
}

/** One line on stderr pointing at the command that replaces an alias */
function warnDeprecated(alias: string, replacement: string): void {
	console.error(
		`${chalk.yellow('⚠')} ${alias} is deprecated; use ${theme.brand(`taskgraph ${replacement}`)}`
	);
}

/**
 * Ask before deleting a tag and its tasks. Without a terminal a prompt would
 * wait forever, so that needs --yes instead.
 */
async function confirmDelete(tagName: string, taskCount: number) {
	const what = `tag ${terminalSafe(tagName)} and its ${taskCount === 1 ? 'task' : `${taskCount} tasks`}`;
	if (!(process.stdin.isTTY && process.stdout.isTTY)) {
		throw withHint(
			`Deleting ${what} needs confirmation`,
			'Pass `--yes` to delete it without asking'
		);
	}
	try {
		const { default: inquirer } = await import('inquirer');
		const prompt = inquirer.createPromptModule({ clearPromptOnDone: true });
		const { proceed } = await prompt([
			{
				type: 'confirm',
				name: 'proceed',
				message: `Delete ${what}? This can't be undone.`,
				default: false
			}
		]);
		return proceed as boolean;
	} catch (error: any) {
		if (error?.name !== 'ExitPromptError') throw error;
		// Ctrl-C
		console.log(theme.muted('Cancelled; nothing was deleted'));
		process.exit(130);
	}
}

/**
 * TagsCommand - Manage tags for task organization
 */
export class TagsCommand extends Command {
	private tmCore?: TmCore;
	private lastResult?: TagsResult;
	private throwOnError: boolean = false;

	constructor(name?: string) {
		super(name || 'tags');

		// Configure the command with options that apply to default list action
		this.description('Manage tags for task organization')
			.option('--show-metadata', 'Show additional tag metadata')
			.option('--ready', 'Show only tags with ready tasks available')
			.option('--json', 'Output the tag list as JSON');

		// Add subcommands
		this.addListCommand();
		this.addAddCommand();
		this.addUseCommand();
		this.addRemoveCommand();
		this.addRenameCommand();
		this.addCopyCommand();

		// Default action: list tags (with options from parent command)
		this.action(async (options) => {
			await this.executeList(options);
		});
	}

	/**
	 * Add list subcommand
	 */
	private addListCommand(): void {
		this.command('list')
			.description('List all tags with statistics (default action)')
			.option('--show-metadata', 'Show additional tag metadata')
			.option('--ready', 'Show only tags with ready tasks available')
			.option('--json', 'Output the tag list as JSON')
			.addHelpText(
				'after',
				`
Examples:
  $ tm tags          # List all tags (default)
  $ tm tags list     # List all tags (explicit)
  $ tm tags list --show-metadata  # List with metadata
  $ tm tags list --ready  # Show only tags with parallelizable work
  $ tm tags --json        # Tags with counts, for scripts
`
			)
			.action(async (options) => {
				// The parent `tags` declares the same flags and parses them first,
				// so `tags list --json` lands on the parent's options
				await this.executeList({ ...this.opts(), ...options });
			});
	}

	/**
	 * Add add subcommand
	 */
	private addAddCommand(): void {
		this.command('add')
			.description('Create a new tag')
			.argument('[name]', 'Name of the tag to create (omit with --from-branch)')
			.option('--description <desc>', 'Tag description')
			.option('--copy-from <tag>', 'Copy tasks from another tag')
			.option('--from-branch', 'Create tag from current git branch name')
			.addHelpText(
				'after',
				`
Examples:
  $ tm tags add feature-auth         # Create new tag
  $ tm tags add sprint-2 --copy-from sprint-1  # Create with tasks copied
  $ tm tags add --from-branch        # Create from current git branch
`
			)
			.action(async (name, options) => {
				await this.executeAdd(name, options);
			});
	}

	/**
	 * Add use subcommand
	 */
	private addUseCommand(): void {
		this.command('use')
			.description('Switch to a different tag')
			.argument('<name>', 'Name or ID of the tag to switch to')
			.addHelpText(
				'after',
				`
Examples:
  $ tm tags use feature-auth    # Switch by name
  $ tm tags use abc123          # Switch by ID (last 8 chars)
`
			)
			.action(async (name) => {
				await this.executeUse(name);
			});
	}

	/**
	 * Add remove subcommand
	 */
	private addRemoveCommand(): void {
		this.command('remove')
			.description('Remove a tag')
			.argument('<name>', 'Name or ID of the tag to remove')
			.option('-y, --yes', 'Skip confirmation prompt')
			.addHelpText(
				'after',
				`
Examples:
  $ tm tags remove old-feature      # Remove tag with confirmation
  $ tm tags remove old-feature -y   # Remove without confirmation

Warning: This will delete all tasks in the tag!
`
			)
			.action(async (name, options) => {
				await this.executeRemove(name, options);
			});
	}

	/**
	 * Add rename subcommand
	 */
	private addRenameCommand(): void {
		this.command('rename')
			.description('Rename a tag')
			.argument('<oldName>', 'Current tag name')
			.argument('<newName>', 'New tag name')
			.addHelpText(
				'after',
				`
Examples:
  $ tm tags rename old-name new-name
`
			)
			.action(async (oldName, newName) => {
				await this.executeRename(oldName, newName);
			});
	}

	/**
	 * Add copy subcommand
	 */
	private addCopyCommand(): void {
		this.command('copy')
			.description('Copy a tag with all its tasks')
			.argument('<source>', 'Source tag name')
			.argument('<target>', 'Target tag name')
			.option('--description <desc>', 'Description for the new tag')
			.addHelpText(
				'after',
				`
Examples:
  $ taskgraph tags copy sprint-1 sprint-2
  $ taskgraph tags copy sprint-1 sprint-2 --description "Next sprint tasks"
`
			)
			.action(async (source, target, options) => {
				await this.executeCopy(source, target, options);
			});
	}

	/**
	 * Initialize TmCore if not already initialized
	 */
	private async initTmCore(): Promise<TmCore> {
		if (!this.tmCore) {
			this.tmCore = await createTmCore({
				projectPath: getProjectPaths().projectRoot
			});
		}
		return this.tmCore;
	}

	/**
	 * Run one subcommand: record its result, or show its error and exit
	 */
	private async run(
		action: TagsResult['action'],
		work: () => Promise<Omit<TagsResult, 'success' | 'action'>>
	): Promise<void> {
		try {
			this.setLastResult({ success: true, action, ...(await work()) });
		} catch (error: any) {
			displayError(error);
			this.setLastResult({ success: false, action, message: error.message });
			this.handleError(
				error instanceof Error
					? error
					: new Error(error.message || String(error))
			);
		}
	}

	/**
	 * Execute list tags
	 */
	private async executeList(options?: {
		showMetadata?: boolean;
		ready?: boolean;
		json?: boolean;
	}): Promise<void> {
		await this.run('list', async () => {
			const tmCore = await this.initTmCore();
			const result = options?.json
				? await tmCore.tasks.getTagsWithStats({ ready: options.ready })
				: await tmCore.tasks.listTags({ ready: options?.ready });
			if (options?.json) {
				printJson(result);
			} else {
				console.log(
					formatTagList(result.tags, {
						showMetadata: options?.showMetadata,
						ready: options?.ready
					})
				);
			}
			return {
				tags: result.tags,
				currentTag: result.currentTag,
				message: `Found ${result.totalTags} tag(s)`
			};
		});
	}

	/**
	 * Execute add tag
	 */
	private async executeAdd(
		name: string | undefined,
		options?: {
			description?: string;
			copyFrom?: string;
			copyFromCurrent?: boolean;
			fromBranch?: boolean;
		}
	): Promise<void> {
		await this.run('add', async () => {
			if (name && options?.fromBranch) {
				throw withHint(
					'Give a tag name or --from-branch, not both',
					'--from-branch names the tag after the current git branch'
				);
			}
			if (!name && !options?.fromBranch) {
				throw withHint(
					'tags add needs a tag name',
					'Example: `taskgraph tags add feature-auth`, or `--from-branch`'
				);
			}

			const tmCore = await this.initTmCore();
			const createOptions = {
				description: options?.description,
				copyFromTag: options?.copyFrom,
				copyFromCurrent: options?.copyFromCurrent
			};
			const created = options?.fromBranch
				? (
						await tmCore.tasks
							.createTagFromBranch((tagName, { defaultDescription }) =>
								tmCore.tasks.createTag(tagName, {
									...createOptions,
									defaultDescription
								})
							)
							.catch((error: unknown) => {
								throw fromBranchError(error);
							})
					).created
				: await tmCore.tasks.createTag(name as string, createOptions);

			if (options?.copyFrom && created.tasksCopied === 0) {
				console.log(
					`${chalk.yellow('⚠')} Source tag "${terminalSafe(options.copyFrom)}" not found or has no tasks`
				);
			}
			// Only a description the user gave, not the default
			console.log(
				formatTagCreated({ ...created, description: options?.description })
			);
			return { message: `Created tag: ${created.tagName}` };
		});
	}

	/**
	 * Execute use/switch tag
	 */
	private async executeUse(name: string): Promise<void> {
		await this.run('use', async () => {
			const result = await (await this.initTmCore()).tasks.useTag(name);
			console.log(formatTagSwitched(result));
			return {
				currentTag: result.currentTag,
				message: `Switched to tag: ${name}`
			};
		});
	}

	/**
	 * Execute remove tag
	 */
	private async executeRemove(
		name: string,
		options?: { yes?: boolean }
	): Promise<void> {
		await this.run('remove', async () => {
			const result = await (await this.initTmCore()).tasks.deleteTag(name, {
				confirm: options?.yes
					? undefined
					: (taskCount) => confirmDelete(name, taskCount)
			});
			if (!result.deleted) {
				console.log(theme.muted('Cancelled; nothing was deleted'));
				return { message: `Cancelled; tag ${name} was not removed` };
			}
			console.log(formatTagDeleted(result));
			return { message: `Removed tag: ${name}` };
		});
	}

	/**
	 * Execute rename tag
	 */
	private async executeRename(oldName: string, newName: string): Promise<void> {
		await this.run('rename', async () => {
			const result = await (await this.initTmCore()).tasks.renameTag(
				oldName,
				newName
			);
			console.log(formatTagRenamed(result));
			return { message: `Renamed tag from "${oldName}" to "${newName}"` };
		});
	}

	/**
	 * Execute copy tag
	 */
	private async executeCopy(
		source: string,
		target: string,
		options?: { description?: string }
	): Promise<void> {
		await this.run('copy', async () => {
			const result = await (await this.initTmCore()).tasks.copyTag(
				source,
				target,
				{ description: options?.description }
			);
			console.log(formatTagCopied(result));
			return { message: `Copied tag from "${source}" to "${target}"` };
		});
	}

	/**
	 * Set the last result for programmatic access
	 */
	private setLastResult(result: TagsResult): void {
		this.lastResult = result;
	}

	/**
	 * Get the last result (for programmatic usage)
	 */
	getLastResult(): TagsResult | undefined {
		return this.lastResult;
	}

	/**
	 * Enable throwing errors instead of process.exit for programmatic usage
	 * @param shouldThrow If true, throws errors; if false, calls process.exit (default)
	 */
	public setThrowOnError(shouldThrow: boolean): this {
		this.throwOnError = shouldThrow;
		return this;
	}

	/**
	 * Handle error by either exiting or throwing based on throwOnError flag
	 */
	private handleError(error: Error): never {
		if (this.throwOnError) {
			throw error;
		}
		process.exit(1);
	}

	/**
	 * Register this command on an existing program
	 */
	static register(program: Command, name?: string): TagsCommand {
		const tagsCommand = new TagsCommand(name);
		program.addCommand(tagsCommand);
		tagsCommand.registerDeprecatedAliases(program);
		return tagsCommand;
	}

	/**
	 * The commands `tags <…>` replaced, kept working: each warns, then runs
	 * its replacement
	 */
	private registerDeprecatedAliases(program: Command): void {
		const alias = (name: string, replacement: string, what: string) =>
			program
				.command(name)
				.description(
					`[DEPRECATED] ${what} (use "taskgraph ${replacement}" instead)`
				)
				.hook('preAction', () => warnDeprecated(name, replacement));

		alias(
			'add-tag',
			'tags add',
			'Create a new tag context for organizing tasks'
		)
			.argument(
				'[tagName]',
				'Name of the new tag to create (optional when using --from-branch)'
			)
			.option(
				'--copy-from-current',
				'Copy tasks from the current tag to the new tag'
			)
			.option(
				'--copy-from <tag>',
				'Copy tasks from the specified tag to the new tag'
			)
			.option(
				'--from-branch',
				'Create tag name from current git branch (ignores tagName argument)'
			)
			.option('-d, --description <text>', 'Optional description for the tag')
			.action((tagName, options) =>
				// --from-branch named the tag after the branch even with a name given
				this.executeAdd(options.fromBranch ? undefined : tagName, options)
			);

		alias(
			'delete-tag',
			'tags remove',
			'Delete an existing tag and all its tasks'
		)
			.argument('<tagName>', 'Name of the tag to delete')
			.option('-y, --yes', 'Skip confirmation prompts')
			.action((tagName, options) => this.executeRemove(tagName, options));

		alias('use-tag', 'tags use', 'Switch to a different tag context')
			.argument('<tagName>', 'Name of the tag to switch to')
			.action((tagName) => this.executeUse(tagName));

		alias('rename-tag', 'tags rename', 'Rename an existing tag')
			.argument('<oldName>', 'Current name of the tag')
			.argument('<newName>', 'New name for the tag')
			.action((oldName, newName) => this.executeRename(oldName, newName));

		alias(
			'copy-tag',
			'tags copy',
			'Copy an existing tag to create a new tag with the same tasks'
		)
			.argument('<sourceName>', 'Name of the source tag to copy from')
			.argument('<targetName>', 'Name of the new tag to create')
			.option(
				'-d, --description <text>',
				'Optional description for the new tag'
			)
			.action((sourceName, targetName, options) =>
				this.executeCopy(sourceName, targetName, options)
			);
	}
}
