/**
 * tools/utils.js
 * Utility functions for TaskGraph CLI integration
 */

import fs from 'fs';
import path from 'path';
import { namedProjectRoot } from '@tm/core';
import packageJson from '../../../package.json' with { type: 'json' };
import { getCurrentTag } from '../../../scripts/modules/utils.js';

// Cache for version info to avoid repeated file reads
let cachedVersionInfo = null;

/**
 * Get version information from package.json
 * @returns {Object} Version information
 */
function getVersionInfo() {
	// Return cached version if available
	if (cachedVersionInfo) {
		return cachedVersionInfo;
	}

	// Use the imported packageJson directly
	cachedVersionInfo = {
		version: packageJson.version || 'unknown',
		name: packageJson.name || 'taskgraph-ai'
	};
	return cachedVersionInfo;
}

/**
 * Get current tag information for MCP responses
 * @param {string} projectRoot - The project root directory
 * @param {Object} log - Logger object
 * @returns {Object} Tag information object
 */
function getTagInfo(projectRoot, log) {
	try {
		if (!projectRoot) {
			log.warn('No project root provided for tag information');
			return { currentTag: 'master', availableTags: ['master'] };
		}

		const currentTag = getCurrentTag(projectRoot);

		// Read available tags from tasks.json
		let availableTags = ['master']; // Default fallback
		try {
			const tasksJsonPath = path.join(
				projectRoot,
				'.taskgraph',
				'tasks',
				'tasks.json'
			);
			if (fs.existsSync(tasksJsonPath)) {
				const tasksData = JSON.parse(fs.readFileSync(tasksJsonPath, 'utf-8'));

				// If it's the new tagged format, extract tag keys
				if (
					tasksData &&
					typeof tasksData === 'object' &&
					!Array.isArray(tasksData.tasks)
				) {
					const tagKeys = Object.keys(tasksData).filter(
						(key) =>
							tasksData[key] &&
							typeof tasksData[key] === 'object' &&
							Array.isArray(tasksData[key].tasks)
					);
					if (tagKeys.length > 0) {
						availableTags = tagKeys;
					}
				}
			}
		} catch (tagError) {
			log.debug(`Could not read available tags: ${tagError.message}`);
		}

		return {
			currentTag: currentTag || 'master',
			availableTags: availableTags
		};
	} catch (error) {
		log.warn(`Error getting tag information: ${error.message}`);
		return { currentTag: 'master', availableTags: ['master'] };
	}
}

/**
 * Extracts and normalizes the project root path from the MCP session object.
 * @param {Object} session - The MCP session object.
 * @param {Object} log - The MCP logger object.
 * @returns {string|null} - The normalized absolute project root path or null if not found/invalid.
 */
function getProjectRootFromSession(session, log) {
	try {
		// Add detailed logging of session structure
		log.info(
			`Session object: ${JSON.stringify({
				hasSession: !!session,
				hasRoots: !!session?.roots,
				rootsType: typeof session?.roots,
				isRootsArray: Array.isArray(session?.roots),
				rootsLength: session?.roots?.length,
				firstRoot: session?.roots?.[0],
				hasRootsRoots: !!session?.roots?.roots,
				rootsRootsType: typeof session?.roots?.roots,
				isRootsRootsArray: Array.isArray(session?.roots?.roots),
				rootsRootsLength: session?.roots?.roots?.length,
				firstRootsRoot: session?.roots?.roots?.[0]
			})}`
		);

		let rawRootPath = null;
		let decodedPath = null;
		let finalPath = null;

		// Check primary location
		if (session?.roots?.[0]?.uri) {
			rawRootPath = session.roots[0].uri;
			log.info(`Found raw root URI in session.roots[0].uri: ${rawRootPath}`);
		}
		// Check alternate location
		else if (session?.roots?.roots?.[0]?.uri) {
			rawRootPath = session.roots.roots[0].uri;
			log.info(
				`Found raw root URI in session.roots.roots[0].uri: ${rawRootPath}`
			);
		}

		if (rawRootPath) {
			// Decode URI and strip file:// protocol
			decodedPath = rawRootPath.startsWith('file://')
				? decodeURIComponent(rawRootPath.slice(7))
				: rawRootPath; // Assume non-file URI is already decoded? Or decode anyway? Let's decode.
			if (!rawRootPath.startsWith('file://')) {
				decodedPath = decodeURIComponent(rawRootPath); // Decode even if no file://
			}

			// Handle potential Windows drive prefix after stripping protocol (e.g., /C:/...)
			if (
				decodedPath.startsWith('/') &&
				/[A-Za-z]:/.test(decodedPath.substring(1, 3))
			) {
				decodedPath = decodedPath.substring(1); // Remove leading slash if it's like /C:/...
			}

			log.info(`Decoded path: ${decodedPath}`);

			// Normalize slashes and resolve
			const normalizedSlashes = decodedPath.replace(/\\/g, '/');
			finalPath = path.resolve(normalizedSlashes); // Resolve to absolute path for current OS

			log.info(`Normalized and resolved session path: ${finalPath}`);
			return finalPath;
		}

		// Fallback Logic (remains the same)
		log.warn('No project root URI found in session. Attempting fallbacks...');
		const cwd = process.cwd();

		// Fallback 1: Use server path deduction (Cursor IDE)
		const serverPath = process.argv[1];
		if (serverPath && serverPath.includes('mcp-server')) {
			const mcpServerIndex = serverPath.indexOf('mcp-server');
			if (mcpServerIndex !== -1) {
				const projectRoot = path.dirname(
					serverPath.substring(0, mcpServerIndex)
				); // Go up one level

				if (
					fs.existsSync(path.join(projectRoot, 'mcp-server')) ||
					fs.existsSync(path.join(projectRoot, 'package.json'))
				) {
					log.info(
						`Using project root derived from server path: ${projectRoot}`
					);
					return projectRoot; // Already absolute
				}
			}
		}

		// Fallback 2: Use CWD
		log.info(`Using current working directory as ultimate fallback: ${cwd}`);
		return cwd; // Already absolute
	} catch (e) {
		log.error(`Error in getProjectRootFromSession: ${e.message}`);
		// Attempt final fallback to CWD on error
		const cwd = process.cwd();
		log.warn(
			`Returning CWD (${cwd}) due to error during session root processing.`
		);
		return cwd;
	}
}

/**
 * Handle API result with standardized error handling and response formatting
 * @param {Object} result - Result object from API call with success, data, and error properties
 * @param {Object} log - Logger object
 * @param {string} errorPrefix - Prefix for error messages
 * @param {Function} processFunction - Optional function to process successful result data
 * @param {string} [projectRoot] - Optional project root for tag information
 * @returns {Object} - Standardized MCP response object
 */
async function handleApiResult(
	result,
	log,
	errorPrefix = 'API error',
	processFunction = processMCPResponseData,
	projectRoot = null
) {
	// Get version info for every response
	const versionInfo = getVersionInfo();

	// Get tag info if project root is provided
	const tagInfo = projectRoot ? getTagInfo(projectRoot, log) : null;

	if (!result.success) {
		const errorMsg = result.error?.message || `Unknown ${errorPrefix}`;
		log.error(`${errorPrefix}: ${errorMsg}`);
		return createErrorResponse(errorMsg, versionInfo, tagInfo);
	}

	// Process the result data if needed
	const processedData = processFunction
		? processFunction(result.data)
		: result.data;

	log.info('Successfully completed operation');

	// Create the response payload including version info and tag info
	const responsePayload = {
		data: processedData,
		version: versionInfo
	};

	// Add tag information if available
	if (tagInfo) {
		responsePayload.tag = tagInfo;
	}

	return createContentResponse(responsePayload);
}

/**
 * Recursively removes specified fields from task objects, whether single or in an array.
 * Handles common data structures returned by task commands.
 * @param {Object|Array} taskOrData - A single task object or a data object containing a 'tasks' array.
 * @param {string[]} fieldsToRemove - An array of field names to remove.
 * @returns {Object|Array} - The processed data with specified fields removed.
 */
function processMCPResponseData(
	taskOrData,
	fieldsToRemove = ['details', 'testStrategy']
) {
	if (!taskOrData) {
		return taskOrData;
	}

	// Helper function to process a single task object
	const processSingleTask = (task) => {
		if (typeof task !== 'object' || task === null) {
			return task;
		}

		const processedTask = { ...task };

		// Remove specified fields from the task
		fieldsToRemove.forEach((field) => {
			delete processedTask[field];
		});

		// Recursively process subtasks if they exist and are an array
		if (processedTask.subtasks && Array.isArray(processedTask.subtasks)) {
			// Use processArrayOfTasks to handle the subtasks array
			processedTask.subtasks = processArrayOfTasks(processedTask.subtasks);
		}

		return processedTask;
	};

	// Helper function to process an array of tasks
	const processArrayOfTasks = (tasks) => {
		return tasks.map(processSingleTask);
	};

	// Check if the input is a data structure containing a 'tasks' array (like from listTasks)
	if (
		typeof taskOrData === 'object' &&
		taskOrData !== null &&
		Array.isArray(taskOrData.tasks)
	) {
		return {
			...taskOrData, // Keep other potential fields like 'stats', 'filter'
			tasks: processArrayOfTasks(taskOrData.tasks)
		};
	}
	// Check if the input is likely a single task object (add more checks if needed)
	else if (
		typeof taskOrData === 'object' &&
		taskOrData !== null &&
		'id' in taskOrData &&
		'title' in taskOrData
	) {
		return processSingleTask(taskOrData);
	}
	// Check if the input is an array of tasks directly (less common but possible)
	else if (Array.isArray(taskOrData)) {
		return processArrayOfTasks(taskOrData);
	}

	// If it doesn't match known task structures, return it as is
	return taskOrData;
}

/**
 * Creates standard content response for tools
 * @param {string|Object} content - Content to include in response
 * @returns {Object} - Content response object in FastMCP format
 */
function createContentResponse(content) {
	// FastMCP requires text type, so we format objects as JSON strings
	return {
		content: [
			{
				type: 'text',
				text:
					typeof content === 'object'
						? // Format JSON nicely with indentation
							JSON.stringify(content, null, 2)
						: // Keep other content types as-is
							String(content)
			}
		]
	};
}

/**
 * Creates error response for tools
 * @param {string} errorMessage - Error message to include in response
 * @param {Object} [versionInfo] - Optional version information object
 * @param {Object} [tagInfo] - Optional tag information object
 * @returns {Object} - Error content response object in FastMCP format
 */
function createErrorResponse(errorMessage, versionInfo, tagInfo) {
	// Provide fallback version info if not provided
	if (!versionInfo) {
		versionInfo = getVersionInfo();
	}

	let responseText = `Error: ${errorMessage}
Version: ${versionInfo.version}
Name: ${versionInfo.name}`;

	// Add tag information if available
	if (tagInfo) {
		responseText += `
Current Tag: ${tagInfo.currentTag}`;
	}

	return {
		content: [
			{
				type: 'text',
				text: responseText
			}
		],
		isError: true
	};
}

/**
 * Creates a logger wrapper object compatible with core function expectations.
 * Adapts the MCP logger to the { info, warn, error, debug, success } structure.
 * @param {Object} log - The MCP logger instance.
 * @returns {Object} - The logger wrapper object.
 */
function createLogWrapper(log) {
	return {
		info: (message, ...args) => log.info(message, ...args),
		warn: (message, ...args) => log.warn(message, ...args),
		error: (message, ...args) => log.error(message, ...args),
		// Handle optional debug method
		debug: (message, ...args) =>
			log.debug ? log.debug(message, ...args) : null,
		// Map success to info as a common fallback
		success: (message, ...args) => log.info(message, ...args)
	};
}

/**
 * Resolves and normalizes a project root path from various formats.
 * Handles URI encoding, Windows paths, and file protocols.
 * @param {string | undefined | null} rawPath - The raw project root path.
 * @param {object} [log] - Optional logger object.
 * @returns {string | null} Normalized absolute path or null if input is invalid/empty.
 */
function normalizeProjectRoot(rawPath, log) {
	if (!rawPath) return null;
	try {
		let pathString = Array.isArray(rawPath) ? rawPath[0] : String(rawPath);
		if (!pathString) return null;

		// 1. Decode URI Encoding
		// Use try-catch for decoding as malformed URIs can throw
		try {
			pathString = decodeURIComponent(pathString);
		} catch (decodeError) {
			if (log)
				log.warn(
					`Could not decode URI component for path "${rawPath}": ${decodeError.message}. Proceeding with raw string.`
				);
			// Proceed with the original string if decoding fails
			pathString = Array.isArray(rawPath) ? rawPath[0] : String(rawPath);
		}

		// 2. Strip file:// prefix (handle 2 or 3 slashes)
		if (pathString.startsWith('file:///')) {
			pathString = pathString.slice(7); // Slice 7 for file:///, may leave leading / on Windows
		} else if (pathString.startsWith('file://')) {
			pathString = pathString.slice(7); // Slice 7 for file://
		}

		// 3. Handle potential Windows leading slash after stripping prefix (e.g., /C:/...)
		// This checks if it starts with / followed by a drive letter C: D: etc.
		if (
			pathString.startsWith('/') &&
			/[A-Za-z]:/.test(pathString.substring(1, 3))
		) {
			pathString = pathString.substring(1); // Remove the leading slash
		}

		// 4. Normalize backslashes to forward slashes
		pathString = pathString.replace(/\\/g, '/');

		// 5. Resolve to absolute path using server's OS convention
		const resolvedPath = path.resolve(pathString);
		return resolvedPath;
	} catch (error) {
		if (log) {
			log.error(
				`Error normalizing project root path "${rawPath}": ${error.message}`
			);
		}
		return null; // Return null on error
	}
}

/**
 * Higher-order function to wrap MCP tool execute methods.
 * Ensures args.projectRoot is present and normalized before execution, in the
 * order the CLI uses (namedProjectRoot in @tm/core):
 * 1. args.projectRoot (explicitly provided)
 * 2. TASKGRAPH_PROJECT_ROOT, from process.env or else the session's env
 * 3. the session's root folder (getProjectRootFromSession)
 * @param {Function} executeFn - The original async execute(args, context) function.
 * @returns {Function} The wrapped async execute function.
 */
function withNormalizedProjectRoot(executeFn) {
	return async (args, context) => {
		const { log, session } = context;
		let normalizedRoot = null;

		try {
			normalizedRoot =
				namedProjectRoot(
					normalizeProjectRoot(args.projectRoot, log) ?? undefined,
					process.env,
					session?.env
				) ?? getProjectRootFromSession(session, log);

			if (!normalizedRoot) {
				log.error(
					'Could not determine project root from environment, args, or session.'
				);
				return createErrorResponse(
					'Could not determine project root. Please provide projectRoot argument or ensure TASKGRAPH_PROJECT_ROOT environment variable is set.'
				);
			}
			log.info(`Using project root: ${normalizedRoot}`);

			// Inject the normalized root back into args
			const updatedArgs = { ...args, projectRoot: normalizedRoot };

			// Execute the original function with normalized root in args
			return await executeFn(updatedArgs, context);
		} catch (error) {
			log.error(
				`Error within withNormalizedProjectRoot HOF (Normalized Root: ${normalizedRoot}): ${error.message}`
			);
			// Add stack trace if available and debug enabled
			if (error.stack && log.debug) {
				log.debug(error.stack);
			}
			// Return a generic error or re-throw depending on desired behavior
			return createErrorResponse(`Operation failed: ${error.message}`);
		}
	};
}

/**
 * Checks progress reporting capability and returns the validated function or undefined.
 *
 * STANDARD PATTERN for AI-powered, long-running operations (parse-prd, expand-task, expand-all, analyze):
 *
 * This helper should be used as the first step in any MCP tool that performs long-running
 * AI operations. It validates the availability of progress reporting and provides consistent
 * logging about the capability status.
 *
 * Operations that should use this pattern:
 * - parse-prd: Parsing PRD documents with AI
 * - expand-task: Expanding tasks into subtasks
 * - expand-all: Expanding all tasks in batch
 * - analyze-complexity: Analyzing task complexity
 * - update-task: Updating tasks with AI assistance
 * - add-task: Creating new tasks with AI
 * - Any operation that makes AI service calls
 *
 * @example Basic usage in a tool's execute function:
 * ```javascript
 * import { checkProgressCapability } from './utils.js';
 *
 * async execute(args, context) {
 *   const { log, reportProgress, session } = context;
 *
 *   // Always validate progress capability first
 *   const progressCapability = checkProgressCapability(reportProgress, log);
 *
 *   // Pass to direct function - it handles undefined gracefully
 *   const result = await expandTask(taskId, numSubtasks, {
 *     session,
 *     reportProgress: progressCapability,
 *     mcpLog: log
 *   });
 * }
 * ```
 *
 * @example With progress reporting available:
 * ```javascript
 * // When reportProgress is available, users see real-time updates:
 * // "Starting PRD analysis (Input: 5432 tokens)..."
 * // "Task 1/10 - Implement user authentication"
 * // "Task 2/10 - Create database schema"
 * // "Task Generation Completed | Tokens: 5432/1234"
 * ```
 *
 * @example Without progress reporting (graceful degradation):
 * ```javascript
 * // When reportProgress is not available:
 * // - Operation runs normally without progress updates
 * // - Debug log: "reportProgress not available - operation will run without progress updates"
 * // - User gets final result after completion
 * ```
 *
 * @param {Function|undefined} reportProgress - The reportProgress function from MCP context.
 *                                             Expected signature: async (progress: {progress: number, total: number, message: string}) => void
 * @param {Object} log - Logger instance with debug, info, warn, error methods
 * @returns {Function|undefined} The validated reportProgress function or undefined if not available
 */
function checkProgressCapability(reportProgress, log) {
	// Validate that reportProgress is available for long-running operations
	if (typeof reportProgress !== 'function') {
		log.debug(
			'reportProgress not available - operation will run without progress updates'
		);
		return undefined;
	}

	return reportProgress;
}

// Ensure all functions are exported
export {
	getProjectRootFromSession,
	getTagInfo,
	handleApiResult,
	processMCPResponseData,
	createContentResponse,
	createErrorResponse,
	createLogWrapper,
	normalizeProjectRoot,
	withNormalizedProjectRoot,
	checkProgressCapability
};
