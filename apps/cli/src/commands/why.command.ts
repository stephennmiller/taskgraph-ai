/**
 * @fileoverview `taskgraph why`: explain why a task can't be started
 * Thin presentation layer over tm-core's explainBlockers()
 */

import path from 'node:path';
import {
	type BlockerExplanation,
	type TmCore,
	TaskIdSchema,
	createTmCore
} from '@tm/core';
import { Command } from 'commander';
import { renderBlockerExplanation } from '../ui/components/blocker-explanation.component.js';
import { getContentWidth } from '../ui/layout/helpers.js';
import { displayCommandHeader } from '../utils/display-helpers.js';
import { displayError, printError } from '../utils/error-handler.js';
import { getProjectRoot } from '../utils/project-root.js';

export interface WhyCommandOptions {
	id?: string;
	tag?: string;
	format?: 'text' | 'json';
	project?: string;
}

export interface WhyResult extends BlockerExplanation {
	tag: string;
}

export class WhyCommand extends Command {
	private tmCore?: TmCore;

	constructor(name?: string) {
		super(name || 'why');

		this.description('Explain why a task is blocked')
			.argument('[id]', 'Task ID, or a subtask ID like 3.1')
			.option('-i, --id <id>', 'Task ID, or a subtask ID like 3.1')
			.option('-t, --tag <tag>', 'Use a specific tag')
			.option('-f, --format <format>', 'Output format (text, json)', 'text')
			.option(
				'-p, --project <path>',
				'Project root directory (auto-detected if not provided)'
			)
			.action(
				async (taskId: string | undefined, options: WhyCommandOptions) => {
					await this.executeCommand(taskId, options);
				}
			);
	}

	private async executeCommand(
		taskId: string | undefined,
		options: WhyCommandOptions
	): Promise<void> {
		let hasError = false;
		try {
			if (options.format && !['text', 'json'].includes(options.format)) {
				throw new Error(
					`Invalid format: ${options.format}. Valid formats are: text, json`
				);
			}

			const idArg = taskId || options.id;
			if (!idArg) {
				printError('Missing task ID', 'Try `taskgraph why 3`');
				process.exit(1);
			}
			const parsed = TaskIdSchema.safeParse(idArg.trim());
			if (!parsed.success) {
				printError(
					`"${idArg}" isn't a task ID`,
					'Use a number like `3`, or `3.1` for a subtask'
				);
				process.exit(1);
			}

			const projectRoot = path.resolve(getProjectRoot(options.project));
			this.tmCore = await createTmCore({ projectPath: projectRoot });

			const explanation = await this.tmCore.tasks.explainBlockers(parsed.data, {
				tag: options.tag
			});
			const result: WhyResult = {
				...explanation,
				tag: options.tag || this.tmCore.config.getActiveTag()
			};

			if (options.format === 'json') {
				console.log(JSON.stringify(result, null, 2));
			} else {
				this.displayText(result);
			}
		} catch (error: any) {
			hasError = true;
			displayError(error, { skipExit: true });
		} finally {
			this.tmCore = undefined;
		}
		if (hasError) process.exit(1);
	}

	private displayText(result: WhyResult): void {
		displayCommandHeader({ tag: result.tag });
		console.log();
		console.log(
			renderBlockerExplanation(result, { width: getContentWidth() }).join('\n')
		);
	}

	static register(program: Command, name?: string): WhyCommand {
		const command = new WhyCommand(name);
		program.addCommand(command);
		return command;
	}
}
