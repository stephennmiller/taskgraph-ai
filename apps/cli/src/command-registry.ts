/**
 * @fileoverview Centralized Command Registry
 * Provides a single location for registering all CLI commands
 */

import type { Command } from 'commander';

import { AutopilotCommand } from './commands/autopilot/index.js';
import { GenerateCommand } from './commands/generate.command.js';
import { GraphCommand } from './commands/graph.command.js';
// Import all commands
import { ListTasksCommand } from './commands/list.command.js';
import { GithubCommand } from './commands/github/github.command.js';
import { LoopCommand } from './commands/loop.command.js';
import { NextCommand } from './commands/next.command.js';
import { SetStatusCommand } from './commands/set-status.command.js';
import { ShowCommand } from './commands/show.command.js';
import { StartCommand } from './commands/start.command.js';
import { TagsCommand } from './commands/tags.command.js';

/**
 * Command metadata for registration
 */
export interface CommandMetadata {
	name: string;
	description: string;
	commandClass: typeof Command;
	category?: 'task' | 'utility' | 'development';
}

/**
 * Registry of all available commands
 */
export class CommandRegistry {
	/**
	 * All available commands with their metadata
	 */
	private static commands: CommandMetadata[] = [
		// Task Management Commands
		{
			name: 'list',
			description: 'List all tasks with filtering and status overview',
			commandClass: ListTasksCommand as any,
			category: 'task'
		},
		{
			name: 'show',
			description: 'Display detailed information about a specific task',
			commandClass: ShowCommand as any,
			category: 'task'
		},
		{
			name: 'next',
			description: 'Find the next available task to work on',
			commandClass: NextCommand as any,
			category: 'task'
		},
		{
			name: 'graph',
			description: 'Show tasks as a dependency tree',
			commandClass: GraphCommand as any,
			category: 'task'
		},
		{
			name: 'start',
			description: 'Start working on a task with claude-code',
			commandClass: StartCommand as any,
			category: 'task'
		},
		{
			name: 'set-status',
			description: 'Update the status of one or more tasks',
			commandClass: SetStatusCommand as any,
			category: 'task'
		},
		{
			name: 'autopilot',
			description:
				'AI agent orchestration for TDD workflow (start, resume, next, complete, commit, status, abort)',
			commandClass: AutopilotCommand as any,
			category: 'development'
		},
		{
			name: 'loop',
			description: 'Run Claude Code in a loop, one task per iteration',
			commandClass: LoopCommand as any,
			category: 'development'
		},
		{
			name: 'tags',
			description: 'Manage tags for task organization',
			commandClass: TagsCommand as any,
			category: 'task'
		},
		{
			name: 'generate',
			description: 'Generate individual task files from tasks.json',
			commandClass: GenerateCommand as any,
			category: 'utility'
		},
		{
			name: 'github',
			description: 'Push tasks to GitHub Issues (status, push, unlink)',
			commandClass: GithubCommand as any,
			category: 'utility'
		}
	];

	/**
	 * Register all commands on a program instance
	 * @param program - Commander program to register commands on
	 */
	static registerAll(program: Command): void {
		for (const cmd of this.commands) {
			this.registerCommand(program, cmd);
		}
	}

	/**
	 * Register specific commands by category
	 * @param program - Commander program to register commands on
	 * @param category - Category of commands to register
	 */
	static registerByCategory(
		program: Command,
		category: 'task' | 'utility' | 'development'
	): void {
		const categoryCommands = this.commands.filter(
			(cmd) => cmd.category === category
		);

		for (const cmd of categoryCommands) {
			this.registerCommand(program, cmd);
		}
	}

	/**
	 * Register a single command by name
	 * @param program - Commander program to register the command on
	 * @param name - Name of the command to register
	 */
	static registerByName(program: Command, name: string): void {
		const cmd = this.commands.find((c) => c.name === name);
		if (cmd) {
			this.registerCommand(program, cmd);
		} else {
			throw new Error(`Command '${name}' not found in registry`);
		}
	}

	/**
	 * Register a single command
	 * @param program - Commander program to register the command on
	 * @param metadata - Command metadata
	 */
	private static registerCommand(
		program: Command,
		metadata: CommandMetadata
	): void {
		const CommandClass = metadata.commandClass as any;

		// Use the static registration method that all commands have
		if (CommandClass.registerOn) {
			CommandClass.registerOn(program);
		} else if (CommandClass.register) {
			CommandClass.register(program);
		} else {
			// Fallback to creating instance and adding
			const instance = new CommandClass();
			program.addCommand(instance);
		}
	}

	/**
	 * Get all registered command names
	 */
	static getCommandNames(): string[] {
		return this.commands.map((cmd) => cmd.name);
	}

	/**
	 * Get commands by category
	 */
	static getCommandsByCategory(
		category: 'task' | 'utility' | 'development'
	): CommandMetadata[] {
		return this.commands.filter((cmd) => cmd.category === category);
	}

	/**
	 * Add a new command to the registry
	 * @param metadata - Command metadata to add
	 */
	static addCommand(metadata: CommandMetadata): void {
		// Check if command already exists
		if (this.commands.some((cmd) => cmd.name === metadata.name)) {
			throw new Error(`Command '${metadata.name}' already exists in registry`);
		}

		this.commands.push(metadata);
	}

	/**
	 * Remove a command from the registry
	 * @param name - Name of the command to remove
	 */
	static removeCommand(name: string): boolean {
		const index = this.commands.findIndex((cmd) => cmd.name === name);
		if (index >= 0) {
			this.commands.splice(index, 1);
			return true;
		}
		return false;
	}

	/**
	 * Get command metadata by name
	 * @param name - Name of the command
	 */
	static getCommand(name: string): CommandMetadata | undefined {
		return this.commands.find((cmd) => cmd.name === name);
	}

	/**
	 * Check if a command exists
	 * @param name - Name of the command
	 */
	static hasCommand(name: string): boolean {
		return this.commands.some((cmd) => cmd.name === name);
	}

	/**
	 * Get a formatted list of all commands for display
	 */
	static getFormattedCommandList(): string {
		const categories = {
			task: 'Task Management',
			utility: 'Utilities',
			development: 'Development'
		};

		let output = '';

		for (const [category, title] of Object.entries(categories)) {
			const cmds = this.getCommandsByCategory(
				category as keyof typeof categories
			);
			if (cmds.length > 0) {
				output += `\n${title}:\n`;
				for (const cmd of cmds) {
					output += `  ${cmd.name.padEnd(20)} ${cmd.description}\n`;
				}
			}
		}

		return output;
	}
}

/**
 * Convenience function to register all CLI commands
 * @param program - Commander program instance
 */
export function registerAllCommands(program: Command): void {
	CommandRegistry.registerAll(program);
}

/**
 * Convenience function to register commands by category
 * @param program - Commander program instance
 * @param category - Category to register
 */
export function registerCommandsByCategory(
	program: Command,
	category: 'task' | 'utility' | 'development'
): void {
	CommandRegistry.registerByCategory(program, category);
}

// Export the registry for direct access if needed
export default CommandRegistry;
