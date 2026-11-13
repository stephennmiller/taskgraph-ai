/**
 * @fileoverview `taskgraph graph`: draw tasks as a dependency tree
 * Thin presentation layer over tm-core's getDependencyTree()
 */

import path from 'node:path';
import {
	type DependencyTree,
	type TmCore,
	createTmCore,
	formatTaskData,
	neutralizeTaskData
} from '@tm/core';
import { Command } from 'commander';
import { projectOption, tagOption } from '../utils/shared-options.js';
import { renderDependencyTree } from '../ui/components/dependency-tree.component.js';
import { formatNoTasks } from '../ui/formatters/task-list-formatters.js';
import { fencesTaskData, getContentWidth } from '../ui/layout/helpers.js';
import { displayCommandHeader } from '../utils/display-helpers.js';
import { displayError } from '../utils/error-handler.js';
import { jsonOption, printJson } from '../utils/json-output.js';
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
			.addOption(tagOption())
			.option('-f, --format <format>', 'Output format: text or json', 'text')
			.addOption(jsonOption())
			.addOption(projectOption())
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
				printJson(neutralizeTaskData(result));
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
		const headerShown = displayCommandHeader({
			tag: result.tag,
			projectRoot: this.tmCore?.projectPath
		});

		if (result.total === 0) {
			console.log(formatNoTasks());
			return;
		}

		if (headerShown) console.log();
		const lines = renderDependencyTree(result, {
			nextId: result.nextId,
			width: getContentWidth()
		});
		// An agent reads this piped: fence the titles as show and next do
		console.log(formatTaskData(lines.join('\n'), fencesTaskData()));
	}

	static register(program: Command, name?: string): GraphCommand {
		const command = new GraphCommand(name);
		program.addCommand(command);
		return command;
	}
}
