/**
 * @fileoverview `taskgraph models`: show each role's Claude Code model, set
 * one with --set-main/--set-research/--set-fallback, or choose them with
 * --setup, through tm-core's config domain
 */

import { createTmCore, isConfigFilePresent } from '@tm/core';
import chalk from 'chalk';
import { Command, Option } from 'commander';
import {
	type ModelChange,
	formatModelChanges,
	formatModelChoices,
	formatModelConfiguration
} from '../../ui/formatters/model-formatters.js';
import { terminalSafe } from '../../ui/formatters/markdown-formatters.js';
import { displayError, printError } from '../../utils/error-handler.js';
import { getProjectRoot } from '../../utils/project-root.js';
import { runInteractiveSetup } from './setup.js';

interface ModelsCommandOptions {
	setMain?: string;
	setResearch?: string;
	setFallback?: string;
	setup?: boolean;
	[removedFlag: string]: unknown;
}

// Removed providers: accepted only to explain why they no longer work
const REMOVED_PROVIDER_FLAGS = [
	'openrouter',
	'ollama',
	'bedrock',
	'azure',
	'vertex',
	'gemini-cli',
	'codex-cli',
	'lmstudio',
	'openai-compatible'
];

const camel = (flag: string) =>
	flag.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

export class ModelsCommand extends Command {
	constructor(name?: string) {
		super(name || 'models');

		this.description('Manage AI model configurations (Claude Code models)')
			.option(
				'--set-main <model_id>',
				'Set the primary model for task generation/updates'
			)
			.option(
				'--set-research <model_id>',
				'Set the model for research-backed operations'
			)
			.option(
				'--set-fallback <model_id>',
				'Set the model to use if the primary fails'
			)
			.option('--setup', 'Run interactive setup to configure models')
			// Accepted for older scripts; Claude Code is the only provider now
			.addOption(new Option('--claude-code').hideHelp());
		for (const flag of REMOVED_PROVIDER_FLAGS) {
			this.addOption(new Option(`--${flag}`).hideHelp());
		}
		this.addOption(new Option('--baseURL <url>').hideHelp())
			.addHelpText(
				'after',
				`
TaskGraph uses Claude Code. Available models: opus, sonnet, haiku.

Examples:
  $ taskgraph models                              # View current configuration
  $ taskgraph models --set-main sonnet             # Set main model
  $ taskgraph models --set-research opus           # Set research model
  $ taskgraph models --set-fallback haiku          # Set fallback
  $ taskgraph models --setup                       # Run interactive setup`
			)
			.action(async (options: ModelsCommandOptions) => {
				await this.executeCommand(options);
			});
	}

	private async executeCommand(options: ModelsCommandOptions): Promise<void> {
		const removed = [...REMOVED_PROVIDER_FLAGS, 'baseURL'].find(
			(flag) => options[camel(flag)]
		);
		if (removed) {
			printError(
				`--${removed} isn't supported any more; TaskGraph runs on Claude Code`,
				'Choose a model with `taskgraph models --set-main <opus|sonnet|haiku>`'
			);
			process.exit(1);
		}

		const projectRoot = getProjectRoot();
		if (!isConfigFilePresent(projectRoot)) {
			printError(
				'No .taskgraph/config.json in this project',
				'Run `taskgraph init` to recreate it'
			);
			process.exit(1);
		}
		const { config } = await createTmCore({ projectPath: projectRoot });

		if (options.setup) {
			try {
				const ok = await runInteractiveSetup(config);
				if (!ok && !process.exitCode) process.exitCode = 1;
			} catch (setupError) {
				displayError(setupError);
			}
			return;
		}

		let active;
		try {
			const result = config.getModelConfiguration((message) =>
				console.error(`${chalk.yellow('⚠')} ${terminalSafe(message)}`)
			);
			if (!result.success) throw new Error(result.error.message);
			active = result.data.activeModels;
		} catch (error) {
			printError(
				`Couldn't read the model settings: ${(error as Error).message}`,
				'Run `taskgraph init` to recreate .taskgraph/config.json'
			);
			process.exit(1);
		}
		const available = config.getAvailableModelsList();
		const availableIds = available.success
			? available.data.models.map((m) => m.modelId)
			: [];

		const requested = (
			[
				['main', options.setMain],
				['research', options.setResearch],
				['fallback', options.setFallback]
			] as const
		).filter(([, modelId]) => modelId);

		if (requested.length === 0) {
			console.log(
				formatModelConfiguration(
					{
						main: active.main?.modelId ?? null,
						research: active.research?.modelId ?? null,
						fallback: active.fallback?.modelId ?? null
					},
					availableIds
				)
			);
			return;
		}

		// Check every model first, so a typo in one flag sets nothing
		const unknown = requested.find(
			([, modelId]) => !availableIds.includes(modelId as string)
		);
		if (unknown) {
			printError(
				`"${terminalSafe(unknown[1])}" isn't a Claude Code model`,
				`Choose ${formatModelChoices(availableIds)}`
			);
			process.exit(1);
		}

		const changes: ModelChange[] = [];
		for (const [role, modelId] of requested) {
			const result = config.setModel(role, modelId);
			if (!result.success) {
				if (changes.length > 0) console.log(formatModelChanges(changes));
				printError(`Couldn't set the ${role} model: ${result.error.message}`);
				process.exit(1);
			}
			changes.push({
				role,
				from: active[role]?.modelId ?? null,
				to: modelId as string
			});
		}
		console.log(formatModelChanges(changes));
	}

	static register(program: Command, name?: string): ModelsCommand {
		const command = new ModelsCommand(name);
		program.addCommand(command);
		return command;
	}
}
