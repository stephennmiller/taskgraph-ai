/**
 * @fileoverview initialize_project MCP tool: set up TaskGraph in the project
 * through tm-core's initializeProject, as `taskgraph init --yes` does, with
 * Claude Code always on. Name, schema and reply are the legacy tool's.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RULE_PROFILES, initializeProject } from '@tm/core';
import type { FastMCP } from 'fastmcp';
import { z } from 'zod';
import { replyWith } from '../../shared/tool-reply.js';
import { withNormalizedProjectRoot } from '../../shared/utils.js';

const InitializeProjectSchema = z.object({
	skipInstall: z
		.boolean()
		.optional()
		.default(false)
		.describe(
			'Skip installing dependencies automatically. Never do this unless you are sure the project is already installed.'
		),
	addAliases: z
		.boolean()
		.optional()
		.default(false)
		.describe(
			"Add the tm alias to the user's shell startup file. Only when the user asks for it."
		),
	initGit: z
		.boolean()
		.optional()
		.default(true)
		.describe('Initialize Git repository in project root.'),
	storeTasksInGit: z
		.boolean()
		.optional()
		.default(true)
		.describe('Store tasks in Git (tasks.json and tasks/ directory).'),
	yes: z
		.boolean()
		.optional()
		.default(true)
		.describe(
			'Skip prompts and use default values. Always set to true for MCP tools.'
		),
	projectRoot: z
		.string()
		.describe(
			'The root directory for the project. ALWAYS SET THIS TO THE PROJECT ROOT DIRECTORY. IF NOT SET, THE TOOL WILL NOT WORK.'
		),
	rules: z
		.array(z.enum(RULE_PROFILES))
		.optional()
		.describe(
			`List of rule profiles to include at initialization. If omitted, defaults to the Claude profile. Available options: ${RULE_PROFILES.join(', ')}`
		)
});

type InitializeProjectArgs = z.infer<typeof InitializeProjectSchema>;

const NEXT_STEP =
	'Now that the project is initialized, the next step is to create the tasks by parsing a PRD. This will create the tasks folder and the initial task files (tasks folder will be created when parse-prd is run). The parse-prd tool will require a prd.txt file as input (typically found in .taskgraph/docs/ directory). You can create a prd.txt file by asking the user about their idea, and then using the .taskgraph/templates/example_prd.txt file as a template to generate a prd.txt file in .taskgraph/docs/. You may skip all of this if the user already has a prd.txt file. You can THEN use the parse-prd tool to create the tasks. So: step 1 after initialization is to create a prd.txt file in .taskgraph/docs/prd.txt or confirm the user already has one. Step 2 is to use the parse-prd tool to create the tasks. Do not bother looking for tasks after initialization, just use the parse-prd tool to create the tasks after creating a prd.txt from which to parse the tasks. You do NOT need to reinitialize the project to parse-prd.';

/**
 * The CLI beside this server's script (dist/taskgraph.js), for the merge
 * driver: run with merge-driver arguments, the server itself would exit 0 on
 * git's stdin and leave "ours", dropping the other branch's tasks. When it
 * isn't there (a source checkout), the driver falls back to git merge-file.
 */
function cliScriptPath(): string {
	const script = process.argv[1] ?? '';
	const real = fs.existsSync(script) ? fs.realpathSync(script) : script;
	return path.join(path.dirname(path.resolve(real)), 'taskgraph.js');
}

/**
 * Register the initialize_project tool with the MCP server
 */
export function registerInitializeProjectTool(server: FastMCP) {
	server.addTool({
		name: 'initialize_project',
		description:
			'Initializes a new TaskGraph project structure by calling the core initialization logic. Creates necessary folders and configuration files for TaskGraph in the current directory.',
		parameters: InitializeProjectSchema,
		annotations: {
			title: 'Initialize Project',
			destructiveHint: true
		},
		execute: withNormalizedProjectRoot(
			async (args: InitializeProjectArgs, context) =>
				replyWith(args, context, 'Initialization failed', async () => {
					const { projectRoot } = args;
					// Never the filesystem root or the home folder
					if (projectRoot === '/' || projectRoot === os.homedir()) {
						throw new Error(
							`Cannot initialize project: Invalid target directory '${projectRoot}' received. Please ensure a valid workspace/folder is open or specified.`
						);
					}
					let result: ReturnType<typeof initializeProject>;
					try {
						// rules allows only claude, so Claude Code is always set up;
						// English, as `init --yes` sets it
						result = initializeProject({
							projectRoot,
							initGit: args.initGit,
							storeTasksInGit: args.storeTasksInGit,
							claudeCode: true,
							aliases: args.addAliases === true,
							responseLanguage: 'English',
							mergeDriverScript: cliScriptPath(),
							// Logged as they happen, so they show even when a later step throws
							onProblem: (problem) =>
								context.log[problem.level](problem.message)
						});
					} catch (error) {
						throw new Error(
							`Core project initialization failed: ${(error as Error).message}`
						);
					}
					const warnings = result.problems.map((problem) => problem.message);
					return {
						data: {
							message: result.problems.some(
								(problem) => problem.level === 'error'
							)
								? 'Project initialized, but some steps failed: see warnings.'
								: 'Project initialized successfully.',
							next_step: NEXT_STEP,
							...(warnings.length > 0 && { warnings })
						}
					};
				})
		)
	});
}
