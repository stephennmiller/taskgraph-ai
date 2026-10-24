/**
 * Shared utilities for MCP tools
 */

import fs from 'node:fs';
import path from 'node:path';
import {
	createTmCore,
	namedProjectRoot,
	resolvePathInsideRoot
} from '@tm/core';
import type { ContentResult, Context } from 'fastmcp';
import packageJson from '../../../../package.json' with { type: 'json' };
import type { ToolContext } from './types.js';

/**
 * Get version information
 */
export function getVersionInfo() {
	return {
		version: packageJson.version || 'unknown',
		name: packageJson.name || 'taskgraph-ai'
	};
}

/**
 * Creates a content response for MCP tools
 * FastMCP requires text type, so we format objects as JSON strings
 */
export function createContentResponse(content: any): ContentResult {
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
 * Creates an error response for MCP tools
 */
export function createErrorResponse(
	errorMessage: string,
	versionInfo?: { version: string; name: string },
	tagInfo?: { currentTag: string }
): ContentResult {
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
 * Function signature for progress reporting
 */
export type ReportProgressFn = (progress: number, total?: number) => void;

/**
 * Validate that reportProgress is available for long-running operations
 */
export function checkProgressCapability(
	reportProgress: any,
	log: any
): ReportProgressFn | undefined {
	if (typeof reportProgress !== 'function') {
		log?.debug?.(
			'reportProgress not available - operation will run without progress updates'
		);
		return undefined;
	}

	return reportProgress;
}

/**
 * Get current tag for a project root
 */
export function getCurrentTag(projectRoot: string): string | null {
	try {
		// Try to read current tag from state.json
		const stateJsonPath = path.join(projectRoot, '.taskgraph', 'state.json');

		if (fs.existsSync(stateJsonPath)) {
			const stateData = JSON.parse(fs.readFileSync(stateJsonPath, 'utf-8'));
			return stateData.currentTag || 'master';
		}

		return 'master';
	} catch {
		return null;
	}
}

/**
 * Handle API result with standardized error handling and response formatting
 * This provides a consistent response structure for all MCP tools
 */
export async function handleApiResult<T>(options: {
	result: { success: boolean; data?: T; error?: { message: string } };
	log?: any;
	errorPrefix?: string;
	projectRoot?: string;
	tag?: string; // Optional tag/brief to use instead of reading from state.json
	/** Print the JSON on one line, without indentation */
	minify?: boolean;
}): Promise<ContentResult> {
	const {
		result,
		log,
		errorPrefix = 'API error',
		projectRoot,
		tag: providedTag,
		minify = false
	} = options;

	// Get version info for every response
	const versionInfo = getVersionInfo();

	// Use provided tag if available, otherwise get from state.json
	// Note: For API storage, tm-core returns the brief name as the tag
	const currentTag =
		providedTag !== undefined
			? providedTag
			: projectRoot
				? getCurrentTag(projectRoot)
				: null;

	if (!result.success) {
		const errorMsg = result.error?.message || `Unknown ${errorPrefix}`;
		log?.error?.(`${errorPrefix}: ${errorMsg}`);

		let errorText = `Error: ${errorMsg}\nVersion: ${versionInfo.version}\nName: ${versionInfo.name}`;

		if (currentTag) {
			errorText += `\nCurrent Tag: ${currentTag}`;
		}

		return {
			content: [
				{
					type: 'text',
					text: errorText
				}
			],
			isError: true
		};
	}

	log?.info?.('Successfully completed operation');

	// Create the response payload including version info and tag
	const responsePayload: any = {
		data: result.data,
		version: versionInfo
	};

	// Add current tag if available
	if (currentTag) {
		responsePayload.tag = currentTag;
	}

	return {
		content: [
			{
				type: 'text',
				text: JSON.stringify(responsePayload, null, minify ? undefined : 2)
			}
		]
	};
}

/**
 * Normalize project root path (handles URI encoding, file:// protocol, Windows paths)
 */
export function normalizeProjectRoot(rawPath: string): string {
	if (!rawPath) return process.cwd();

	try {
		let pathString = rawPath;

		// Decode URI encoding
		try {
			pathString = decodeURIComponent(pathString);
		} catch {
			// If decoding fails, use as-is
		}

		// Strip file:// prefix
		if (pathString.startsWith('file:///')) {
			pathString = pathString.slice(7);
		} else if (pathString.startsWith('file://')) {
			pathString = pathString.slice(7);
		}

		// Handle Windows drive letter after stripping prefix (e.g., /C:/...)
		if (
			pathString.startsWith('/') &&
			/[A-Za-z]:/.test(pathString.substring(1, 3))
		) {
			pathString = pathString.substring(1);
		}

		// Normalize backslashes to forward slashes
		pathString = pathString.replace(/\\/g, '/');

		// Resolve to absolute path
		return path.resolve(pathString);
	} catch {
		return path.resolve(rawPath);
	}
}

/**
 * Get project root from session object
 */
function getProjectRootFromSession(session: any): string | null {
	try {
		// Check primary location
		if (session?.roots?.[0]?.uri) {
			return normalizeProjectRoot(session.roots[0].uri);
		}
		// Check alternate location
		else if (session?.roots?.roots?.[0]?.uri) {
			return normalizeProjectRoot(session.roots.roots[0].uri);
		}
		return null;
	} catch {
		return null;
	}
}

const TAG_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Wrapper to normalize project root in args, in the order the CLI uses
 * (namedProjectRoot in @tm/core):
 * 1. args.projectRoot (explicitly provided)
 * 2. TASKGRAPH_PROJECT_ROOT, from process.env or else the session's env
 * 3. the session's root folder
 */
export function withNormalizedProjectRoot<T extends { projectRoot?: string }>(
	fn: (
		args: T & { projectRoot: string },
		context: Context<undefined>
	) => Promise<ContentResult>
): (args: T, context: any) => Promise<ContentResult> {
	return async (args: T, context: any): Promise<ContentResult> => {
		const { log, session } = context;
		// A tag becomes part of file names and git branch names
		const tag = (args as { tag?: unknown }).tag;
		if (
			tag !== undefined &&
			!(typeof tag === 'string' && TAG_PATTERN.test(tag))
		) {
			return createErrorResponse(
				`Invalid tag "${String(tag)}": use only letters, numbers, hyphens and underscores`
			);
		}
		let normalizedRoot: string | null = null;

		try {
			normalizedRoot =
				namedProjectRoot(
					args.projectRoot ? normalizeProjectRoot(args.projectRoot) : undefined,
					process.env,
					session?.env
				) ?? getProjectRootFromSession(session);

			if (!normalizedRoot) {
				log?.error?.(
					'Could not determine project root from environment, args, or session.'
				);
				return handleApiResult({
					result: {
						success: false,
						error: {
							message:
								'Could not determine project root. Please provide projectRoot argument or ensure TASKGRAPH_PROJECT_ROOT environment variable is set.'
						}
					}
				});
			}
			log?.info?.(`Using project root: ${normalizedRoot}`);

			// Inject the normalized root back into args
			const updatedArgs = { ...args, projectRoot: normalizedRoot } as T & {
				projectRoot: string;
			};

			// Execute the original function with normalized root in args
			return await fn(updatedArgs, context);
		} catch (error: any) {
			log?.error?.(
				`Error within withNormalizedProjectRoot HOF (Normalized Root: ${normalizedRoot}): ${error.message}`
			);
			if (error.stack && log?.debug) {
				log.debug(error.stack);
			}
			return handleApiResult({
				result: {
					success: false,
					error: {
						message: `Operation failed: ${error.message}`
					}
				}
			});
		}
	};
}

/**
 * Tool execution function signature with tmCore provided
 */
export type ToolExecuteFn<TArgs = any, TResult = any> = (
	args: TArgs,
	context: ToolContext
) => Promise<TResult>;

/**
 * Higher-order function that wraps MCP tool execution with:
 * - Normalized project root (via withNormalizedProjectRoot)
 * - TmCore instance creation
 *
 * Use this for ALL MCP tools to provide a consistent context.
 *
 * @param executeFn - Tool execution function that receives args and enhanced context
 * @returns Wrapped execute function
 *
 * @example
 * ```ts
 * export function registerAddDependencyTool(server: FastMCP) {
 *   server.addTool({
 *     name: 'add_dependency',
 *     parameters: AddDependencySchema,
 *     execute: withToolContext(async (args, context) => {
 *       // context.tmCore is already available
 *       // Just implement the tool logic!
 *     })
 *   });
 * }
 * ```
 */
export function withToolContext<TArgs extends { projectRoot?: string }>(
	executeFn: ToolExecuteFn<TArgs & { projectRoot: string }, ContentResult>
) {
	return withNormalizedProjectRoot(
		async (
			args: TArgs & { projectRoot: string },
			context: Context<undefined>
		) => {
			// Create tmCore instance
			const tmCore = await createTmCore({
				projectPath: args.projectRoot,
				loggerConfig: { mcpMode: true, logCallback: context.log }
			});

			// Create enhanced context with tmCore
			const enhancedContext: ToolContext = {
				log: context.log,
				session: context.session,
				tmCore
			};

			// Execute the actual tool logic with enhanced context
			return executeFn(args, enhancedContext);
		}
	);
}

/**
 * Resolve a path the model sent and refuse it when it leaves the project,
 * including through a symlink.
 *
 * @param projectRoot - Project directory
 * @param candidate - Absolute path, or relative to projectRoot
 * @returns Absolute path inside projectRoot, with symlinks followed
 * @throws When projectRoot does not exist or the path is outside it
 */
export function resolveInsideRoot(
	projectRoot: string,
	candidate: string
): string {
	const resolved = resolvePathInsideRoot(
		fs.realpathSync(projectRoot),
		candidate
	);
	if (resolved === null) {
		throw new Error(
			`Path '${candidate}' is outside the project root '${projectRoot}'`
		);
	}
	return resolved;
}

/**
 * Validates and parses metadata string for MCP tools.
 * Checks environment flag, validates JSON format, and ensures metadata is a plain object.
 *
 * @param metadataString - JSON string to parse and validate
 * @param errorResponseFn - Function to create error response
 * @returns Object with parsed metadata or error
 */
export function validateMcpMetadata(
	metadataString: string | null | undefined,
	errorResponseFn: (message: string) => ContentResult
): { parsedMetadata: Record<string, unknown> | null; error?: ContentResult } {
	// Return null if no metadata provided
	if (!metadataString) {
		return { parsedMetadata: null };
	}

	// Check if metadata updates are allowed via environment variable
	const allowMetadataUpdates =
		process.env.TASKGRAPH_ALLOW_METADATA_UPDATES === 'true';
	if (!allowMetadataUpdates) {
		return {
			parsedMetadata: null,
			error: errorResponseFn(
				'Metadata updates are disabled. Set TASKGRAPH_ALLOW_METADATA_UPDATES=true in your MCP server environment to enable metadata modifications.'
			)
		};
	}

	// Parse and validate JSON
	try {
		const parsedMetadata = JSON.parse(metadataString);

		// Ensure it's a plain object (not null, not array)
		if (
			typeof parsedMetadata !== 'object' ||
			parsedMetadata === null ||
			Array.isArray(parsedMetadata)
		) {
			return {
				parsedMetadata: null,
				error: errorResponseFn(
					'Invalid metadata: must be a JSON object (not null or array)'
				)
			};
		}

		return { parsedMetadata };
	} catch (parseError: unknown) {
		const message =
			parseError instanceof Error ? parseError.message : 'Unknown parse error';
		return {
			parsedMetadata: null,
			error: errorResponseFn(
				`Invalid metadata JSON: ${message}. Provide a valid JSON object string.`
			)
		};
	}
}
