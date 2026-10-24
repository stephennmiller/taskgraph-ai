/**
 * @fileoverview analyze_project_complexity and complexity_report MCP tools:
 * score tasks with the AI into the tag's complexity report, and read that
 * report, through tm-core's tasks.analyzeComplexity() and getComplexityReport()
 */

import path from 'node:path';
import { COMPLEXITY_REPORT_FILE, TASKGRAPH_TASKS_FILE } from '@tm/core';
import type { FastMCP } from 'fastmcp';
import { z } from 'zod';
import { errorMessage } from '../../shared/tool-reply.js';
import type { ToolContext } from '../../shared/types.js';
import {
	createErrorResponse,
	handleApiResult,
	resolveInsideRoot,
	withToolContext
} from '../../shared/utils.js';

// The schema clients see; kept as the legacy tool had it, `file` included
const AnalyzeSchema = z.object({
	threshold: z.coerce
		.number()
		.int()
		.min(1)
		.max(10)
		.optional()
		.default(5)
		.describe('Complexity score threshold (1-10) to recommend expansion.'),
	research: z
		.boolean()
		.optional()
		.default(false)
		.describe('Use Claude Code web research for research-backed analysis.'),
	output: z
		.string()
		.optional()
		.describe(
			`Output file path relative to project root (default: ${COMPLEXITY_REPORT_FILE}).`
		),
	file: z
		.string()
		.optional()
		.describe(
			'Path to the tasks file; only .taskgraph/tasks/tasks.json is accepted, so leave it out'
		),
	ids: z
		.string()
		.optional()
		.describe(
			'Comma-separated list of task IDs to analyze specifically (e.g., "1,3,5").'
		),
	from: z.coerce
		.number()
		.int()
		.positive()
		.optional()
		.describe('Starting task ID in a range to analyze.'),
	to: z.coerce
		.number()
		.int()
		.positive()
		.optional()
		.describe('Ending task ID in a range to analyze.'),
	projectRoot: z
		.string()
		.describe('The directory of the project. Must be an absolute path.'),
	tag: z.string().optional().describe('Tag context to operate on')
});

type AnalyzeArgs = z.infer<typeof AnalyzeSchema>;

const ReportSchema = z.object({
	file: z
		.string()
		.optional()
		.describe(`Path to the report file (default: ${COMPLEXITY_REPORT_FILE})`),
	projectRoot: z
		.string()
		.describe('The directory of the project. Must be an absolute path.')
});

type ReportArgs = z.infer<typeof ReportSchema>;

const errorPrefix = 'Error analyzing task complexity';

export function registerAnalyzeComplexityTool(server: FastMCP) {
	server.addTool({
		name: 'analyze_project_complexity',
		description:
			'Analyze task complexity and generate expansion recommendations.',
		parameters: AnalyzeSchema,
		annotations: {
			title: 'Analyze Project Complexity',
			destructiveHint: true
		},
		execute: withToolContext(
			async (args: AnalyzeArgs, { log, session, tmCore }: ToolContext) => {
				const { projectRoot } = args;
				const tag = args.tag || tmCore.config.getActiveTag();
				log.info(
					`Executing analyze_project_complexity tool with args: ${JSON.stringify(args)}`
				);

				// tm-core reads the project's tasks.json; any other file is refused
				if (
					args.file &&
					path.resolve(projectRoot, args.file) !==
						path.join(projectRoot, TASKGRAPH_TASKS_FILE)
				) {
					return createErrorResponse(
						`analyze_project_complexity reads only ${TASKGRAPH_TASKS_FILE}, not ${args.file}; leave out file`
					);
				}
				let output: string | undefined;
				try {
					output = args.output
						? resolveInsideRoot(projectRoot, args.output)
						: undefined;
				} catch (error) {
					return createErrorResponse((error as Error).message);
				}

				// Sent in the reply too: the client may not show the log
				const warnings: string[] = [];
				try {
					const result = await tmCore.tasks.analyzeComplexity(
						{
							ids: args.ids,
							from: args.from,
							to: args.to,
							threshold: args.threshold,
							research: args.research,
							output,
							tag,
							session,
							outputType: 'mcp'
						},
						{
							onWarning: (message) => {
								warnings.push(message);
								log.warn(message);
							},
							onDebug: (message) => log.debug(message)
						}
					);
					const analyses = result.report.complexityAnalysis ?? [];
					const scores = analyses.map((t) => t.complexityScore);
					return handleApiResult({
						result: {
							success: true,
							data: {
								message: result.unchanged
									? `No active task matched, so the report at ${result.reportPath} is unchanged`
									: `Task complexity analysis complete. Report saved to ${result.reportPath}`,
								reportPath: result.reportPath,
								reportSummary: {
									taskCount: analyses.length,
									highComplexityTasks: scores.filter((s) => s >= 8).length,
									mediumComplexityTasks: scores.filter((s) => s >= 5 && s < 8)
										.length,
									lowComplexityTasks: scores.filter((s) => s < 5).length
								},
								fullReport: result.report,
								telemetryData: result.telemetryData,
								tagInfo: result.tagInfo,
								...(warnings.length > 0 && { warnings })
							}
						},
						log,
						errorPrefix,
						projectRoot,
						tag
					});
				} catch (error: unknown) {
					// The fix tm-core suggests, e.g. the threshold's range
					const message = errorMessage(error);
					return handleApiResult({
						result: {
							success: false,
							error: {
								message: `Error running core complexity analysis: ${message}`
							}
						},
						log,
						errorPrefix,
						projectRoot,
						tag
					});
				}
			}
		)
	});
}

export function registerComplexityReportTool(server: FastMCP) {
	server.addTool({
		name: 'complexity_report',
		description: 'Display the complexity analysis report in a readable format',
		parameters: ReportSchema,
		annotations: {
			title: 'Complexity Report',
			readOnlyHint: true
		},
		execute: withToolContext(
			async (args: ReportArgs, { log, tmCore }: ToolContext) => {
				const { projectRoot } = args;
				const reply = (
					result: Parameters<typeof handleApiResult>[0]['result']
				) =>
					handleApiResult({
						result,
						log,
						errorPrefix: 'Error retrieving complexity report',
						projectRoot
					});
				try {
					const file = args.file
						? resolveInsideRoot(projectRoot, args.file)
						: undefined;
					const found = tmCore.tasks.getComplexityReport({ file });
					if (found) {
						return reply({ success: true, data: found });
					}
					if (!file) {
						return createErrorResponse(
							'No complexity report found. Run taskgraph analyze-complexity first.'
						);
					}
					return reply({
						success: false,
						error: {
							message: `No complexity report found at ${file}. Run 'analyze-complexity' first.`
						}
					});
				} catch (error) {
					return createErrorResponse(
						`Failed to retrieve complexity report: ${(error as Error).message}`
					);
				}
			}
		)
	});
}
