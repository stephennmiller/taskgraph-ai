---
description: Guidelines for implementing and interacting with the TaskGraph MCP Server
paths:
  - "apps/mcp/**/*"
---
# TaskGraph MCP Server Guidelines

How the TaskGraph Model Context Protocol (MCP) server is built and how to add a tool to it. The server runs on FastMCP over stdio and is the published `taskgraph-mcp` / `taskgraph-ai` bin.

## Architecture Overview (See also: `architecture.md`)

- **Flow**: `External Tool (Claude Code)` <-> FastMCP server ([`apps/mcp/src/server.ts`](../../apps/mcp/src/server.ts)) <-> MCP tools (`apps/mcp/src/tools/<area>/*.tool.ts`) <-> `@tm/core` (`tmCore.tasks`, `tmCore.config`, ...).
- **Entry**: [`apps/mcp/src/main.ts`](../../apps/mcp/src/main.ts), built by the root `tsdown.config.ts` to `dist/mcp-server.js`. It sets `TASKGRAPH_MCP=true` (tm-core's logger then stays off stdout), then dynamically imports `server.js` and calls `startServer()`. Keep that order: a static import runs first, and modules that build a logger at load time would miss MCP mode (#612).
- **Server**: `TaskGraphMCPServer` in `server.ts` creates the FastMCP instance with `SERVER_INSTRUCTIONS`, registers the tools `TASKGRAPH_TOOLS` picks, and starts on stdio. `SERVER_INSTRUCTIONS` reach the model even when tool schemas are deferred; keep them three lines naming only core tools (`server.spec.ts` checks this).
- **Startup log**: [`apps/mcp/src/logger.ts`](../../apps/mcp/src/logger.ts) writes to stderr at the project's `global.logLevel`. Inside a tool, log through the context's `log` instead.
- **No business logic in tools**: a tool validates its parameters, calls tm-core and shapes the reply. Parsing, validation of task data and file I/O belong in `@tm/core` (see `CLAUDE.md`).

## Tool registry and tiers

[`apps/mcp/src/tools/tool-registry.ts`](../../apps/mcp/src/tools/tool-registry.ts) holds:

- `toolRegistry`: every tool by the name clients see, mapped to its `register*Tool` function.
- `coreTools` (7) and `standardTools` (16, core included): the tiers.
- `registerTaskGraphTools(server, toolMode)`: registers `all`, `core` (alias `lean`, the default), `standard`, or a comma-separated list of names. List names match in any case and with `_` and `-` swapped; a list with no known name registers every tool.

`TASKGRAPH_TOOLS` in the client's MCP config sets the mode. `.mcp.json` only starts the server; it has no list of tools.

## Writing a tool

One file per tool or small family under `apps/mcp/src/tools/<area>/`, named `<name>.tool.ts`, exporting `register<Name>Tool(server: FastMCP)` and re-exported from that area's `index.ts`.

```typescript
import type { FastMCP } from 'fastmcp';
import { z } from 'zod';
import { replyWith } from '../../shared/tool-reply.js';
import type { ToolContext } from '../../shared/types.js';
import { withToolContext } from '../../shared/utils.js';

const YourSchema = z.object({
	id: z.string().describe("Task ID (e.g., '15' or '15.2')"),
	projectRoot: z
		.string()
		.describe('The directory of the project. Must be an absolute path.'),
	tag: z.string().optional().describe('Tag context to operate on')
});

export function registerYourTool(server: FastMCP) {
	server.addTool({
		name: 'your_tool',
		description: 'What it does, and when to reach for it',
		parameters: YourSchema,
		annotations: { title: 'Your Tool', destructiveHint: false },
		execute: withToolContext(
			async (args: z.infer<typeof YourSchema>, context: ToolContext) =>
				replyWith(args, context, 'Error running your_tool', async () => {
					const result = await context.tmCore.tasks.yourMethod(args.id, {
						tag: args.tag
					});
					return { tag: result.tag, data: result };
				})
		)
	});
}
```

- **`withToolContext`** ([`apps/mcp/src/shared/utils.ts`](../../apps/mcp/src/shared/utils.ts)) resolves and normalizes `projectRoot`, creates a `tmCore` for it, and passes `{ log, session, reportProgress, tmCore }`. Use **`withNormalizedProjectRoot`** instead when there is no project to open yet (`initialize_project`).
- **Project root**: resolved in the order the CLI uses (`namedProjectRoot` in `@tm/core`): `args.projectRoot`, else `TASKGRAPH_PROJECT_ROOT` (process or session env), else the session's root folder. One inside the variable's `.taskgraph/worktrees/` gives the variable's project. `normalizeProjectRoot` decodes URIs, strips `file://`, fixes `/C:/` prefixes and backslashes, and makes the path absolute. A path the model sends inside the project goes through `resolveInsideRoot`, which refuses one outside it.
- **`replyWith(args, context, errorPrefix, work)`** ([`apps/mcp/src/shared/tool-reply.ts`](../../apps/mcp/src/shared/tool-reply.ts)) runs `work`, replies with its `data` (and `tag`, when the work reports the tag it used), and turns a throw into an error reply. It refuses a `file` argument that isn't the project's tasks.json; older clients still send `file`, so keep it in a schema that had it. `replyId` gives a task ID as replies have always shown it (a number for a task, a string for a subtask).
- **`handleApiResult({ result, log, errorPrefix, projectRoot, tag })`** is what `replyWith` calls; use it directly when a tool replies in more than one shape. Success is `{ data, version, tag }` as JSON text; failure is an `isError` reply with the message, version and tag. Pass `tag` whenever the tool takes one, or the reply names the current tag instead (`tests/integration/tools/reply-tag.tool.test.ts` checks this).
- **Schemas** are what clients see: renaming a tool, a parameter or a reply field breaks callers. Keep the names, and say in a comment when a field stays only for older clients.
- **Long work** runs inline and returns the finished result; there is no job queue. For progress the client can show, call `reportProgress` when it is defined (`parse-prd.tool.ts`), and don't let a failed report fail work that is already saved. Otherwise use `log.info()`.
- **Session**: `session.env` carries the env the MCP client config sets, and `session.roots` the client's folders.

## Adding a tool

1. Add or extend the tm-core method the tool calls, with its tests (`packages/tm-core/src/**/*.spec.ts`).
2. Write `apps/mcp/src/tools/<area>/<name>.tool.ts` as above and export its register function from the area's `index.ts`.
3. Add `your_tool: registerYourTool` to `toolRegistry`, and the name to `coreTools` or `standardTools` if it belongs in that tier. A tier change also changes the counts in `tool-registry.spec.ts`, the README tier table and `llms-install.md` (`tests/unit/taskgraph-claude-md-drift.test.ts` checks them).
4. Test the reply shape in `<name>.tool.spec.ts` next to the tool (mock tm-core responses, real FastMCP), and the whole call against the built server in `apps/mcp/tests/integration/tools/` (`callMCPTool` in `tests/helpers/call-mcp-tool.ts`, after `npm run build`).

## Naming

- Files: kebab-case, `<name>.tool.ts`.
- Register functions: `register<Name>Tool` (camelCase).
- Tool names clients see: snake_case (`set_task_status`), with the action in the name and no filler (`get_tasks`, not `get_all_tasks`). `response-language` keeps its hyphen; lists may name it `response_language`.
