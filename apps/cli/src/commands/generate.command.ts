/**
 * @fileoverview Generate command for generating individual task files from tasks.json
 * This is a thin presentation layer over @tm/core
 */

import path from 'node:path';
import {
	type GenerateTaskFilesResult,
	type TmCore,
	createTmCore
} from '@tm/core';
import { Command } from 'commander';
import {
	formatGenerateError,
	formatGenerateResult
} from '../ui/formatters/generate-formatters.js';
import { displayCommandHeader } from '../utils/display-helpers.js';
import { displayError, printError } from '../utils/error-handler.js';
import { jsonOption, printJson } from '../utils/json-output.js';
import { getProjectRoot } from '../utils/project-root.js';

/**
 * Options interface for the generate command
 */
export interface GenerateCommandOptions {
	tag?: string;
	output?: string;
	project?: string;
	format?: 'text' | 'json';
}

/**
 * GenerateCommand extending Commander's Command class
 * Generates individual task files from tasks.json
 */
export class GenerateCommand extends Command {
	private tmCore?: TmCore;
	private lastResult?: GenerateTaskFilesResult;

	constructor(name?: string) {
		super(name || 'generate');

		// Configure the command
		this.description('Generate individual task files from tasks.json')
			.option('-t, --tag <tag>', 'Tag context for task operations')
			.option(
				'-o, --output <dir>',
				'Output directory for generated files (defaults to .taskgraph/tasks)'
			)
			.option(
				'-p, --project <path>',
				'Project root directory (auto-detected if not provided)'
			)
			.option('-f, --format <format>', 'Output format (text, json)', 'text')
			.addOption(jsonOption())
			.action(async (options: GenerateCommandOptions) => {
				await this.executeCommand(options);
			});
	}

	/**
	 * Execute the generate command
	 */
	private async executeCommand(options: GenerateCommandOptions): Promise<void> {
		let hasError = false;
		try {
			// Validate options
			this.validateOptions(options);

			// Initialize tm-core
			const projectRoot = getProjectRoot(options.project);
			await this.initializeCore(projectRoot);

			// Generate task files
			const result = await this.generateFiles(projectRoot, options);

			// Store result for programmatic access
			this.lastResult = result;

			// Display results
			this.displayResults(result, options);
		} catch (error: any) {
			hasError = true;
			displayError(error, { skipExit: true });
		} finally {
			await this.cleanup();
		}

		if (hasError) {
			process.exit(1);
		}
	}

	/**
	 * Validate command options
	 */
	private validateOptions(options: GenerateCommandOptions): void {
		if (options.format && !['text', 'json'].includes(options.format)) {
			throw new Error(
				`Invalid format: ${options.format}. Valid formats are: text, json`
			);
		}
	}

	/**
	 * Initialize TmCore
	 */
	private async initializeCore(projectRoot: string): Promise<void> {
		if (!this.tmCore) {
			const resolved = path.resolve(projectRoot);
			this.tmCore = await createTmCore({ projectPath: resolved });
		}
	}

	/**
	 * Generate task files using tm-core
	 */
	private async generateFiles(
		projectRoot: string,
		options: GenerateCommandOptions
	): Promise<GenerateTaskFilesResult> {
		if (!this.tmCore) {
			throw new Error('TmCore not initialized');
		}

		// Resolve output directory
		const outputDir = options.output
			? path.resolve(projectRoot, options.output)
			: undefined;

		// Call tm-core to generate task files
		return this.tmCore.tasks.generateTaskFiles({
			tag: options.tag,
			outputDir
		});
	}

	/**
	 * Display results based on format
	 */
	private displayResults(
		result: GenerateTaskFilesResult,
		options: GenerateCommandOptions
	): void {
		const format = options.format || 'text';

		switch (format) {
			case 'json':
				this.displayJson(result);
				break;

			case 'text':
			default:
				this.displayText(result, options);
				break;
		}
	}

	/**
	 * Display in JSON format
	 */
	private displayJson(result: GenerateTaskFilesResult): void {
		printJson(result);
	}

	/**
	 * Display in text format
	 */
	private displayText(
		result: GenerateTaskFilesResult,
		options: GenerateCommandOptions
	): void {
		if (this.tmCore) {
			const activeTag = options.tag || this.tmCore.config.getActiveTag();

			displayCommandHeader({
				tag: activeTag,
				projectRoot: this.tmCore.projectPath
			});
		}

		const projectRoot = this.tmCore?.projectPath ?? process.cwd();
		if (!result.success) {
			const { message, hint } = formatGenerateError(result, projectRoot);
			printError(message, hint);
			process.exitCode = 1;
			return;
		}

		console.log(formatGenerateResult(result, projectRoot));
	}

	/**
	 * Get the last result (for programmatic usage)
	 */
	getLastResult(): GenerateTaskFilesResult | undefined {
		return this.lastResult;
	}

	/**
	 * Clean up resources
	 */
	async cleanup(): Promise<void> {
		if (this.tmCore) {
			this.tmCore = undefined;
		}
	}

	/**
	 * Register this command on an existing program
	 */
	static register(program: Command, name?: string): GenerateCommand {
		const generateCommand = new GenerateCommand(name);
		program.addCommand(generateCommand);
		return generateCommand;
	}
}
