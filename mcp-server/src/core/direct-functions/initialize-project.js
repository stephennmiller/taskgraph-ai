import os from 'os'; // Import os module for home directory check
import { initializeProject } from '@tm/core';

/**
 * Direct function wrapper for initializing a project.
 * Derives target directory from session, sets CWD, and calls core init logic.
 * @param {object} args - Arguments containing initialization options (addAliases, initGit, storeTasksInGit, skipInstall, yes, projectRoot, rules)
 * @param {object} log - The FastMCP logger instance.
 * @param {object} context - The context object, must contain { session }.
 * @returns {Promise<{success: boolean, data?: any, error?: {code: string, message: string}}>} - Standard result object.
 */
export async function initializeProjectDirect(args, log, context = {}) {
	const { session } = context; // Keep session if core logic needs it
	const homeDir = os.homedir();

	log.info(`Args received in direct function: ${JSON.stringify(args)}`);

	// --- Determine Target Directory ---
	// TRUST the projectRoot passed from the tool layer via args
	// The HOF in the tool layer already normalized and validated it came from a reliable source (args or session)
	const targetDirectory = args.projectRoot;

	// --- Validate the targetDirectory (basic sanity checks) ---
	if (
		!targetDirectory ||
		typeof targetDirectory !== 'string' || // Ensure it's a string
		targetDirectory === '/' ||
		targetDirectory === homeDir
	) {
		log.error(
			`Invalid target directory received from tool layer: '${targetDirectory}'`
		);
		return {
			success: false,
			error: {
				code: 'INVALID_TARGET_DIRECTORY',
				message: `Cannot initialize project: Invalid target directory '${targetDirectory}' received. Please ensure a valid workspace/folder is open or specified.`,
				details: `Received args.projectRoot: ${args.projectRoot}` // Show what was received
			}
		};
	}

	// --- Proceed with validated targetDirectory ---
	log.info(`Validated target directory for initialization: ${targetDirectory}`);

	let resultData;
	let success = false;
	let errorResult = null;

	try {
		// rules accepts only claude, so the Claude Code integration is always
		// set up; the language is English, as `init --yes` sets it
		const result = initializeProject({
			projectRoot: targetDirectory,
			initGit: args.initGit,
			storeTasksInGit: args.storeTasksInGit,
			claudeCode: true,
			// only an explicit true edits the shell rc
			aliases: args.addAliases === true,
			responseLanguage: 'English'
		});
		for (const problem of result.problems) {
			log.warn(problem.message);
		}

		resultData = {
			message: 'Project initialized successfully.',
			next_step:
				'Now that the project is initialized, the next step is to create the tasks by parsing a PRD. This will create the tasks folder and the initial task files (tasks folder will be created when parse-prd is run). The parse-prd tool will require a prd.txt file as input (typically found in .taskgraph/docs/ directory). You can create a prd.txt file by asking the user about their idea, and then using the .taskgraph/templates/example_prd.txt file as a template to generate a prd.txt file in .taskgraph/docs/. You may skip all of this if the user already has a prd.txt file. You can THEN use the parse-prd tool to create the tasks. So: step 1 after initialization is to create a prd.txt file in .taskgraph/docs/prd.txt or confirm the user already has one. Step 2 is to use the parse-prd tool to create the tasks. Do not bother looking for tasks after initialization, just use the parse-prd tool to create the tasks after creating a prd.txt from which to parse the tasks. You do NOT need to reinitialize the project to parse-prd.'
		};
		success = true;
		log.info(
			`Project initialization completed successfully in ${targetDirectory}.`
		);
	} catch (error) {
		log.error(`Core initializeProject failed: ${error.message}`);
		errorResult = {
			code: 'INITIALIZATION_FAILED',
			message: `Core project initialization failed: ${error.message}`,
			details: error.stack
		};
		success = false;
	}

	if (success) {
		return { success: true, data: resultData };
	} else {
		return { success: false, error: errorResult };
	}
}
