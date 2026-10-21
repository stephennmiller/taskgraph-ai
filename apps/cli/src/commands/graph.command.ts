/**
 * @fileoverview `taskgraph graph`: draw tasks as a dependency tree
 * Thin presentation layer over tm-core's getDependencyTree()
 */

import path from 'node:path';
import { type DependencyTree, type TmCore, createTmCore } from '@tm/core';
import chalk from 'chalk';
import { Command } from 'commander';
import { renderDependencyTree } from '../ui/components/dependency-tree.component.js';
import { getContentWidth } from '../ui/layout/helpers.js';
import { theme } from '../ui/theme.js';
import { displayCommandHeader } from '../utils/display-helpers.js';
import { displayError } from '../utils/error-handler.js';
import { getProjectRoot } from '../utils/project-root.js';

export interface GraphCommandOptions {
	id?: string;
	tag?: string;
	format?: 'text' | 'json';
	project?: string;
}

export interface GraphResult extends DependencyTree {
	tag: string;
	nextId: string | null;
}

export class GraphCommand extends Command {
	private tmCore?: TmCore;

	constructor(name?: string) {
		super(name || 'graph');

		this.description('Show tasks as a dependency tree')
			.option(
				'-i, --id <id>',
				'Show only this task and the tasks drawn under it'
			)
			.option('-t, --tag <tag>', 'Use a specific tag')
			.option('-f, --format <format>', 'Output format (text, json)', 'text')
			.option(
				'-p, --project <path>',
				'Project root directory (auto-detected if not provided)'
			)
			.action(async (options: GraphCommandOptions) => {
				await this.executeCommand(options);
			});
	}

	private async executeCommand(options: GraphCommandOptions): Promise<void> {
		let hasError = false;
		try {
			if (options.format && !['text', 'json'].includes(options.format)) {
				throw new Error(
					`Invalid format: ${options.format}. Valid formats are: text, json`
				);
			}
			const projectRoot = path.resolve(getProjectRoot(options.project));
			this.tmCore = await createTmCore({ projectPath: projectRoot });

			const tree = await this.tmCore.tasks.getDependencyTree({
				tag: options.tag,
				rootId: options.id
			});
			const next = await this.tmCore.tasks.getNext(options.tag);
			const result: GraphResult = {
				...tree,
				tag: options.tag || this.tmCore.config.getActiveTag(),
				nextId: next ? String(next.id) : null
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

	private displayText(result: GraphResult): void {
		displayCommandHeader({ tag: result.tag });

		if (result.total === 0) {
			console.log(chalk.yellow('No tasks yet.'));
			console.log(
				`${theme.muted('Create some with')} ${theme.brand('taskgraph parse-prd')} ${theme.muted('or')} ${theme.brand('taskgraph add-task')}`
			);
			return;
		}

		console.log();
		const lines = renderDependencyTree(result, {
			nextId: result.nextId,
			width: getContentWidth()
		});
		console.log(lines.join('\n'));
	}

	static register(program: Command, name?: string): GraphCommand {
		const command = new GraphCommand(name);
		program.addCommand(command);
		return command;
	}
}
