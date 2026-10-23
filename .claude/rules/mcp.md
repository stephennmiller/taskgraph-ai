---
description: Guidelines for implementing and interacting with the TaskGraph MCP Server
paths:
  - "mcp-server/src/**/*"
  - "scripts/modules/**/*"
---
# TaskGraph MCP Server Guidelines

This document outlines the architecture and implementation patterns for the TaskGraph Model Context Protocol (MCP) server, designed for integration with tools like Claude Code.

## Architecture Overview (See also: `architecture.md`)

The MCP server acts as a bridge between external tools (like Claude Code) and the core TaskGraph CLI logic. It leverages FastMCP for the server framework.

- **Flow**: `External Tool (Claude Code)` <-> `FastMCP Server` <-> `MCP Tools` (`mcp-server/src/tools/*.js`) <-> `Core Logic Wrappers` (`mcp-server/src/core/direct-functions/*.js`, exported via `taskgraph-core.js`) <-> `Core Modules` (`scripts/modules/*.js`)
- **Goal**: Provide a performant and reliable way for external tools to interact with TaskGraph functionality without directly invoking the CLI for every operation.

## Direct Function Implementation Best Practices

When implementing a new direct function in `mcp-server/src/core/direct-functions/`, follow these critical guidelines:

1. **Verify Function Dependencies**:
   - ✅ **DO**: Check that all helper functions your direct function needs are properly exported from their source modules
   - ✅ **DO**: Import these dependencies explicitly at the top of your file
   - ❌ **DON'T**: Assume helper functions like `findTaskById` or `taskExists` are automatically available
   - **Example**:
     ```javascript
     // At top of direct-function file
     import { removeTask, findTaskById, taskExists } from '../../../../scripts/modules/task-manager.js';
     ```

2. **Parameter Verification and Completeness**:
   - ✅ **DO**: Verify the signature of core functions you're calling and ensure all required parameters are provided
   - ✅ **DO**: Pass explicit values for required parameters rather than relying on defaults
   - ✅ **DO**: Double-check parameter order against function definition
   - ❌ **DON'T**: Omit parameters assuming they have default values
   - **Example**:
     ```javascript
     // Correct parameter handling in direct function
     async function generateTaskFilesDirect(args, log) {
       const tasksPath = findTasksJsonPath(args, log);
       const outputDir = args.output || path.dirname(tasksPath);
       
       try {
         // Pass all required parameters
         const result = await generateTaskFiles(tasksPath, outputDir);
         return { success: true, data: result, fromCache: false };
       } catch (error) {
         // Error handling...
       }
     }
     ```

3. **Consistent File Path Handling**:
   - ✅ **DO**: Use `path.join()` instead of string concatenation for file paths
   - ✅ **DO**: Follow established file naming conventions (`task_001.txt` not `1.md`)
   - ✅ **DO**: Use `path.dirname()` and other path utilities for manipulating paths
   - ✅ **DO**: When paths relate to task files, follow the standard format: `task_${id.toString().padStart(3, '0')}.txt`
   - ❌ **DON'T**: Create custom file path handling logic that diverges from established patterns
   - **Example**:
     ```javascript
     // Correct file path handling
     const taskFilePath = path.join(
       path.dirname(tasksPath),
       `task_${taskId.toString().padStart(3, '0')}.txt`
     );
     ```

4. **Comprehensive Error Handling**:
   - ✅ **DO**: Wrap core function calls *and AI calls* in try/catch blocks
   - ✅ **DO**: Log errors with appropriate severity and context
   - ✅ **DO**: Return standardized error objects with code and message (`{ success: false, error: { code: '...', message: '...' } }`)
   - ✅ **DO**: Handle file system errors, AI client errors, AI processing errors, and core function errors distinctly with appropriate codes.
   - **Example**:
     ```javascript
     try {
       // Core function call or AI logic
     } catch (error) {
       log.error(`Failed to execute direct function logic: ${error.message}`);
       return {
         success: false,
         error: {
           code: error.code || 'DIRECT_FUNCTION_ERROR', // Use specific codes like AI_CLIENT_ERROR, etc.
           message: error.message,
           details: error.stack // Optional: Include stack in debug mode
         },
         fromCache: false // Ensure this is included if applicable
       };
     }
     ```

5. **Handling Logging Context (`mcpLog`)**:
   - **Requirement**: Core functions (like those in `task-manager.js`) may accept an `options` object containing an optional `mcpLog` property. If provided, the core function expects this object to have methods like `mcpLog.info(...)`, `mcpLog.error(...)`.
   - **Solution: The Logger Wrapper Pattern**: When calling a core function from a direct function, pass the `log` object provided by FastMCP *wrapped* in the standard `logWrapper` object. This ensures the core function receives a logger with the expected method structure.
     ```javascript
     // Standard logWrapper pattern within a Direct Function
     const logWrapper = {
       info: (message, ...args) => log.info(message, ...args),
       warn: (message, ...args) => log.warn(message, ...args),
       error: (message, ...args) => log.error(message, ...args),
       debug: (message, ...args) => log.debug && log.debug(message, ...args),
       success: (message, ...args) => log.info(message, ...args)
     };

     // ... later when calling the core function ...
     await coreFunction(
       // ... other arguments ...
       { 
         mcpLog: logWrapper, // Pass the wrapper object
         session // Also pass session if needed by core logic or AI service
       },
       'json' // Pass 'json' output format if supported by core function
     );
     ```
   - **JSON Output**: Passing `mcpLog` (via the wrapper) often triggers the core function to use a JSON-friendly output format, suppressing spinners/boxes.
   - ✅ **DO**: Implement this pattern in direct functions calling core functions that might use `mcpLog`.

6. **Silent Mode Implementation**:
    - ✅ **DO**: Import silent mode utilities: `import { enableSilentMode, disableSilentMode, isSilentMode } from '../../../../scripts/modules/utils.js';`
    - ✅ **DO**: Wrap core function calls *within direct functions* using `enableSilentMode()` / `disableSilentMode()` in a `try/finally` block if the core function might produce console output (spinners, boxes, direct `console.log`) that isn't reliably controlled by passing `{ mcpLog }` or an `outputFormat` parameter.
    - ✅ **DO**: Always disable silent mode in the `finally` block.
    - ❌ **DON'T**: Wrap calls to the unified AI service (`generateTextService`, `generateObjectService`) in silent mode; their logging is handled internally.
    - **Example (Direct Function Guaranteeing Silence & using Log Wrapper)**:
      ```javascript
      export async function coreWrapperDirect(args, log, context = {}) {
        const { session } = context;
        const tasksPath = findTasksJsonPath(args, log);
        const logWrapper = { /* ... */ };

        enableSilentMode(); // Ensure silence for direct console output
        try {
          const result = await coreFunction(
             tasksPath,
             args.param1,
             { mcpLog: logWrapper, session }, // Pass context
             'json' // Request JSON format if supported
          );
          return { success: true, data: result };
        } catch (error) {
           log.error(`Error: ${error.message}`);
           return { success: false, error: { /* ... */ } };
        } finally {
           disableSilentMode(); // Critical: Always disable in finally
        }
      }
      ```

7. **Debugging MCP/Core Logic Interaction**:
    - ✅ **DO**: If an MCP tool fails with unclear errors (like JSON parsing failures), run the equivalent `taskgraph` CLI command in the terminal. The CLI often provides more detailed error messages originating from the core logic (e.g., `ReferenceError`, stack traces) that are obscured by the MCP layer.

## Tool Definition and Execution

### Tool Structure

MCP tools must follow a specific structure to properly interact with the FastMCP framework:

```javascript
server.addTool({
  name: "tool_name",  // Use snake_case for tool names
  description: "Description of what the tool does",
  parameters: z.object({
    // Define parameters using Zod
    param1: z.string().describe("Parameter description"),
    param2: z.number().optional().describe("Optional parameter description"),
    // IMPORTANT: For file operations, always include these optional parameters
    file: z.string().optional().describe("Path to the tasks file"),
    projectRoot: z.string().optional().describe("Root directory of the project (typically derived from session)")
  }),

  // The execute function is the core of the tool implementation
  execute: async (args, context) => {
    // Implementation goes here
    // Return response in the appropriate format
  }
});
```

### Execute Function Signature

The `execute` function receives validated arguments and the FastMCP context:

```javascript
// Destructured signature (recommended)
execute: async (args, { log, session }) => {
  // Tool implementation
}
```

- **args**: Validated parameters.
- **context**: Contains `{ log, session }` from FastMCP, plus `reportProgress` for tools that stream progress (see Progress Reporting below).

### Standard Tool Execution Pattern with Path Normalization (Updated)

To ensure consistent handling of project paths across different client environments (Windows, macOS, Linux, WSL) and input formats (e.g., `file:///...`, URI encoded paths), all MCP tool `execute` methods that require access to the project root **MUST** be wrapped with the `withNormalizedProjectRoot` Higher-Order Function (HOF).

This HOF, exported by `@tm/mcp` ([`apps/mcp/src/shared/utils.ts`](../../apps/mcp/src/shared/utils.ts)), performs the following before calling the tool's core logic:

1.  **Determines the Root:** It uses the order the CLI uses (`namedProjectRoot` in `@tm/core`): `args.projectRoot` if the client passed one, else the `TASKGRAPH_PROJECT_ROOT` environment variable (from the process or the session), else the root folder in the session (`getProjectRootFromSession`). An explicit `projectRoot` wins over the variable, except one inside the variable's `.taskgraph/worktrees/`, which gives the variable's project.
2.  **Normalizes the Path:** It uses the `normalizeProjectRoot` helper on `args.projectRoot` to decode URIs, strip `file://` prefixes, fix potential Windows drive letter prefixes (e.g., `/C:/`), convert backslashes (`\`) to forward slashes (`/`), and resolve the path to an absolute path suitable for the server's OS.
3.  **Injects Normalized Path:** It updates the `args` object by replacing the original `projectRoot` (or adding it) with the normalized, absolute path.
4.  **Executes Original Logic:** It calls the original `execute` function body, passing the updated `args` object.

**Implementation Example:**

```javascript
// In mcp-server/src/tools/your-tool.js
import {
    handleApiResult,
    createErrorResponse,
    withNormalizedProjectRoot // <<< Import HOF
} from '@tm/mcp';
import { yourDirectFunction } from '../core/taskgraph-core.js';
import { findTasksJsonPath } from '../core/utils/path-utils.js'; // If needed

export function registerYourTool(server) {
    server.addTool({
        name: "your_tool",
        description: "...".
        parameters: z.object({
            // ... other parameters ...
            projectRoot: z.string().optional().describe('...') // projectRoot is optional here, HOF handles fallback
        }),
        // Wrap the entire execute function
        execute: withNormalizedProjectRoot(async (args, { log, session }) => {
            // args.projectRoot is now guaranteed to be normalized and absolute
            const { /* other args */, projectRoot } = args;

            try {
                log.info(`Executing your_tool with normalized root: ${projectRoot}`);

                // Resolve paths using the normalized projectRoot
                let tasksPath = findTasksJsonPath({ projectRoot, file: args.file }, log);

                // Call direct function, passing normalized projectRoot if needed by direct func
                const result = await yourDirectFunction(
                    {
                        /* other args */,
                        projectRoot // Pass it if direct function needs it
                    },
                    log,
                    { session }
                );

                return handleApiResult({ result, log, projectRoot });
            } catch (error) {
                log.error(`Error in your_tool: ${error.message}`);
                return createErrorResponse(error.message);
            }
        }) // End HOF wrap
    });
}
```

By using this HOF, the core logic within the `execute` method and any downstream functions (like `findTasksJsonPath` or direct functions) can reliably expect `args.projectRoot` to be a clean, absolute path suitable for the server environment.

### Project Initialization Tool

The `initialize_project` tool allows integrated clients like Claude Code to set up a new TaskGraph project:

```javascript
// In initialize-project.js
import { z } from "zod";
import { initializeProjectDirect } from "../core/taskgraph-core.js";
import { handleApiResult, createErrorResponse } from "@tm/mcp";

export function registerInitializeProjectTool(server) {
  server.addTool({
    name: "initialize_project",
    description: "Initialize a new TaskGraph project",
    parameters: z.object({
      projectName: z.string().optional().describe("The name for the new project"),
      projectDescription: z.string().optional().describe("A brief description"),
      projectVersion: z.string().optional().describe("Initial version (e.g., '0.1.0')"),
      authorName: z.string().optional().describe("The author's name"),
      skipInstall: z.boolean().optional().describe("Skip installing dependencies"),
      addAliases: z.boolean().optional().describe("Add shell aliases"),
      yes: z.boolean().optional().describe("Skip prompts and use defaults")
    }),
    execute: async (args, { log, reportProgress }) => {
      try {
        // Since we're initializing, we don't need project root
        const result = await initializeProjectDirect(args, log);
        return handleApiResult({ result, log, errorPrefix: 'Error initializing project' });
      } catch (error) {
        log.error(`Error in initialize_project: ${error.message}`);
        return createErrorResponse(`Failed to initialize project: ${error.message}`);
      }
    }
  });
}
```

### Logging Convention

The `log` object (destructured from `context`) provides standardized logging methods. Use it within both the `execute` method and the `*Direct` functions. For progress the client can show, pass `reportProgress` through instead (see Progress Reporting below).

```javascript
// Proper logging usage
log.info(`Starting ${toolName} with parameters: ${JSON.stringify(sanitizedArgs)}`);
log.debug("Detailed operation info", { data });
log.warn("Potential issue detected");
log.error(`Error occurred: ${error.message}`, { stack: error.stack });
log.info('Progress: 50% - AI call initiated...'); // Example progress logging
```

## Session Usage Convention

The `session` object (destructured from `context`) contains authenticated session data and client information.

- **Authentication**: Access user-specific data (`session.userId`, etc.) if authentication is implemented.
- **Project Root**: The primary use in TaskGraph is accessing `session.roots` to determine the client's project root directory through `withNormalizedProjectRoot` from `@tm/mcp` ([`apps/mcp/src/shared/utils.ts`](../../apps/mcp/src/shared/utils.ts)). See the Standard Tool Execution Pattern above.
- **Environment Variables**: The `session.env` object provides access to environment variables set in the MCP client configuration (e.g., `.mcp.json`). This is the **primary mechanism** for the unified AI service layer (`ai-services-unified.js`) to securely access **API keys** when called from MCP context.
- **Capabilities**: Can be used to check client capabilities (`session.clientCapabilities`).

## Direct Function Wrappers (`*Direct`)

These functions, located in `mcp-server/src/core/direct-functions/`, form the core logic execution layer for MCP tools.

- **Purpose**: Bridge MCP tools and core TaskGraph modules (`scripts/modules/*`). Handle AI interactions if applicable.
- **Responsibilities**:
  - Receive `args` (including `projectRoot`), `log`, and optionally `{ session }` context.
  - Find `tasks.json` using `findTasksJsonPath`.
  - Validate arguments.
  - **Call Core Logic**: Invoke function from `scripts/modules/*`.
    - Pass `outputFormat: 'json'` if applicable.
    - Wrap with `enableSilentMode/disableSilentMode` if needed.
    - Pass `{ mcpLog: logWrapper, session }` context if core logic needs it.
  - Handle errors.
  - Return standardized result object.
  - ❌ **DON'T**: Call `reportProgress` yourself; only forward it to core logic when the tool passed it in `context`.
  - ❌ **DON'T**: Initialize AI clients or call AI services directly.

## Key Principles

- **Prefer Direct Function Calls**: MCP tools should always call `*Direct` wrappers instead of running the CLI.
- **Standardized Execution Flow**: Follow the pattern: MCP Tool (`withNormalizedProjectRoot` resolves `projectRoot`) -> `*Direct` Function -> Core Logic / AI Logic.
- **Path Resolution via Direct Functions**: The `*Direct` function is responsible for finding the exact `tasks.json` path using `findTasksJsonPath`, relying on the `projectRoot` passed in `args`.
- **AI Logic in Core Modules**: AI interactions (prompt building, calling unified service) reside within the core logic functions (`scripts/modules/*`), not direct functions.
- **Silent Mode in Direct Functions**: Wrap *core function* calls (from `scripts/modules`) with `enableSilentMode()` and `disableSilentMode()` if they produce console output not handled by `outputFormat`. Do not wrap AI calls.
- **Long-Running Work Runs Inline**: Tools await their `*Direct` function and return the finished result. There is no background job queue or operation-status tool.
- **Progress Reporting**: For long work (like `parse_prd`), take `reportProgress` from the tool context, validate it with `checkProgressCapability(reportProgress, log)` from `@tm/mcp` ([`apps/mcp/src/shared/utils.ts`](../../apps/mcp/src/shared/utils.ts)), and pass the result in the `*Direct` function's `context`. The direct function forwards it to core logic, which calls it only when it is defined. Otherwise use `log.info()`.
- **Output Formatting**: Ensure core functions called by `*Direct` functions can suppress CLI output, ideally via an `outputFormat` parameter.
- **Project Initialization**: Use the initialize_project tool for setting up new projects in integrated environments.
- **Centralized Utilities**: Tools import their helpers (`withNormalizedProjectRoot`, `handleApiResult`, `createErrorResponse`, `checkProgressCapability`) from `@tm/mcp` ([`apps/mcp/src/shared/utils.ts`](../../apps/mcp/src/shared/utils.ts)). Direct functions use `mcp-server/src/core/utils/path-utils.js` for paths and `createLogWrapper` from `mcp-server/src/tools/utils.js`. See `utilities.md`.

## Resources and Resource Templates

Resources provide LLMs with static or dynamic data without executing tools.

- **Implementation**: Use `@mcp.resource()` decorator pattern or `server.addResource`/`server.addResourceTemplate` in `mcp-server/src/core/resources/`.
- **Registration**: Register resources during server initialization in [`mcp-server/src/index.js`](../../mcp-server/src/index.js).
- **Best Practices**: Organize resources, validate parameters, use consistent URIs, handle errors. See the FastMCP documentation for underlying SDK details.

*(Self-correction: Removed detailed Resource implementation examples as they were less relevant to the current user focus on tool execution flow and project roots. Kept the overview.)*

## Implementing MCP Support for a Command

Follow these steps to add MCP support for an existing TaskGraph command (see `new-features.md` for more detail):

1.  **Ensure Core Logic Exists**: Verify the core functionality is implemented and exported from the relevant module in `scripts/modules/`. Ensure the core function can suppress console output (e.g., via an `outputFormat` parameter).

2. **Create Direct Function File in `mcp-server/src/core/direct-functions/`**:
    - Create a new file (e.g., `your-command.js`) using **kebab-case** naming.
    - Import necessary core functions, `findTasksJsonPath`, and silent mode utilities.
    - Implement `async function yourCommandDirect(args, log, context = {})` using **camelCase** with `Direct` suffix. **Remember `context` should only contain `{ session }` if needed (for AI keys/config).**
        - **Path Resolution**: Obtain `tasksPath` using `findTasksJsonPath(args, log)`.
        - Parse other `args` and perform necessary validation.
        - **AI commands**: Don't create AI clients or build prompts here. The core function calls the unified AI service; pass it `session` (and `mcpLog`) so it can read API keys from `session.env`.
        - **Call Core Logic**:
            - Wrap with `enableSilentMode/disableSilentMode` if necessary.
            - Pass `outputFormat: 'json'` (or similar) if applicable.
            - Handle errors from the core function.
        - Format the return as `{ success: true/false, data/error, fromCache?: boolean }`.
        - ❌ **DON'T**: Call `reportProgress` yourself; forward it from `context` to core logic if the tool passed it.
    - Export the wrapper function.

3.  **Update `taskgraph-core.js` with Import/Export**: Import and re-export your `*Direct` function and add it to the `directFunctions` map.

4.  **Create MCP Tool (`mcp-server/src/tools/`)**:
    - Create a new file (e.g., `your-command.js`) using **kebab-case**.
    - Import `zod`, your `yourCommandDirect` function, and from `@tm/mcp`: `withNormalizedProjectRoot`, `handleApiResult` and `createErrorResponse` (plus `checkProgressCapability` if the command reports progress).
    - Implement `registerYourCommandTool(server)`.
    - Define the tool `name` using **snake_case** (e.g., `your_command`).
    - Define the `parameters` using `zod`. Include `projectRoot: z.string().optional()`.
    - Wrap `execute` in `withNormalizedProjectRoot(async (args, { log, session }) => { ... })`, which resolves and normalizes `args.projectRoot` (see `mcp-server/src/tools/next-task.js`).
        - Call `await yourCommandDirect({ ...args }, log, { session });` and return `handleApiResult({ result, log, errorPrefix, projectRoot: args.projectRoot, tag })`.
        - **If the command is long-running**: also destructure `reportProgress`, and pass `{ session, reportProgress: checkProgressCapability(reportProgress, log) }` as the context (see `mcp-server/src/tools/parse-prd.js`).

5.  **Register Tool**: Import `registerYourCommandTool` in `mcp-server/src/tools/tool-registry.js` and add it to `toolRegistry` under the tool's name (`your_command: registerYourCommandTool`). Add the name to `coreTools` or `standardTools` too if it belongs in that tier; `TASKGRAPH_TOOLS=all` loads every tool in `toolRegistry`, and a comma-separated list can name any of them. Then update `EXPECTED_TOOL_COUNTS` in `tests/helpers/tool-counts.js` (and `EXPECTED_CORE_TOOLS` there for a core tool). A core or standard tool also changes the tier counts asserted in `tests/unit/mcp-server/tools/tool-registry.test.js`.

6.  **No `.mcp.json` change**: `.mcp.json` only starts the server; it has no list of tools.

## Handling Responses

- MCP tools should return the object generated by `handleApiResult` from `@tm/mcp`.
- `handleApiResult` takes one options object: `{ result, log, errorPrefix, projectRoot, tag }`. Only `result` is required. `errorPrefix` defaults to `'API error'`; `tag` overrides the current tag it otherwise reads from `projectRoot`'s `state.json`.
- On success it returns `{ data, version, tag }` as JSON text, where `data` is the `*Direct` function's `data` unchanged. On failure it returns an `isError` response with the error message, version and tag. It does not filter fields, so trim large task data in the direct function if needed.

## Parameter Type Handling

- **Prefer Direct Function Calls**: For optimal performance and error handling, MCP tools should utilize direct function wrappers defined in [`taskgraph-core.js`](../../mcp-server/src/core/taskgraph-core.js). These wrappers call the underlying logic from the core modules (e.g., [`task-manager.js`](../../scripts/modules/task-manager.js)).
- **Standard Tool Execution Pattern**:
    - The `execute` method within each MCP tool (in `mcp-server/src/tools/*.js`) should:
        1.  Call the corresponding `*Direct` function wrapper (e.g., `listTasksDirect`) from [`taskgraph-core.js`](../../mcp-server/src/core/taskgraph-core.js), passing necessary arguments and the logger.
        2.  Receive the result object (typically `{ success, data/error, fromCache }`).
        3.  Pass this result object to the `handleApiResult` utility from `@tm/mcp` ([`apps/mcp/src/shared/utils.ts`](../../apps/mcp/src/shared/utils.ts)) as `handleApiResult({ result, log, errorPrefix, projectRoot })` for standardized response formatting and error handling.
        4.  Return the formatted response object provided by `handleApiResult`.
- **Centralized Utilities** (See also: `utilities.md`):
    - Use `findTasksJsonPath` (in [`taskgraph-core.js`](../../mcp-server/src/core/taskgraph-core.js)) *within direct function wrappers* to locate the `tasks.json` file consistently.
    - **Leverage MCP Utilities**: `@tm/mcp` ([`apps/mcp/src/shared/utils.ts`](../../apps/mcp/src/shared/utils.ts)) exports the helpers tools use:
        - `withNormalizedProjectRoot`: Wraps `execute`; resolves and normalizes `args.projectRoot` (see above).
        - `withToolContext`: Does the same and adds a `tmCore` instance to the context, which then holds only `log`, `session` and `tmCore` (no `reportProgress`).
        - `handleApiResult`: Takes the raw result from a `*Direct` function and formats it into a standard MCP success or error response (see Handling Responses). This is called by the tool's `execute` method.
        - `createContentResponse`/`createErrorResponse`: Format a success or error MCP response directly.

**MCP Tool Implementation Checklist**:

1. **Core Logic Verification**:
   - [ ] Confirm the core function is properly exported from its module (e.g., `task-manager.js`)
   - [ ] Identify all required parameters and their types

2. **Direct Function Wrapper**:
   - [ ] Create the `*Direct` function in the appropriate file in `mcp-server/src/core/direct-functions/`
   - [ ] Import silent mode utilities and implement them around core function calls
   - [ ] Handle all parameter validations and type conversions
   - [ ] Implement path resolving for relative paths
   - [ ] Add appropriate error handling with standardized error codes
   - [ ] Add to imports/exports in `taskgraph-core.js`

3. **MCP Tool Implementation**:
   - [ ] Create new file in `mcp-server/src/tools/` with kebab-case naming
   - [ ] Define zod schema for all parameters
   - [ ] Implement the `execute` method following the standard pattern
   - [ ] For long-running operations, pass `reportProgress` through `checkProgressCapability` to the direct function
   - [ ] Add the tool to `toolRegistry` in `mcp-server/src/tools/tool-registry.js` (and to `coreTools`/`standardTools` if it belongs in that tier)

4. **Testing**:
   - [ ] Write unit tests for the direct function wrapper
   - [ ] Write integration tests for the MCP tool

## Standard Error Codes

- **Standard Error Codes**: Use consistent error codes across direct function wrappers
  - `INPUT_VALIDATION_ERROR`: For missing or invalid required parameters
  - `FILE_NOT_FOUND_ERROR`: For file system path issues
  - `CORE_FUNCTION_ERROR`: For errors thrown by the core function
  - `UNEXPECTED_ERROR`: For all other unexpected errors

- **Error Object Structure**:
  ```javascript
  {
    success: false,
    error: {
      code: 'ERROR_CODE',
      message: 'Human-readable error message'
    },
    fromCache: false
  }
  ```

- **MCP Tool Logging Pattern**:
  - ✅ DO: Log the start of execution with arguments (sanitized if sensitive)
  - ✅ DO: Log successful completion with result summary
  - ✅ DO: Log all error conditions with appropriate log levels
  - ✅ DO: Include the cache status in result logs
  - ❌ DON'T: Log entire large data structures or sensitive information

- The MCP server integrates with TaskGraph core functions through three layers:
  1. Tool Definitions (`mcp-server/src/tools/*.js`) - Define parameters and validation
  2. Direct Functions (`mcp-server/src/core/direct-functions/*.js`) - Handle core logic integration
  3. Core Functions (`scripts/modules/*.js`) - Implement the actual functionality

- This layered approach provides:
  - Clear separation of concerns
  - Consistent parameter validation
  - Centralized error handling
  - Standardized response formatting

## MCP Naming Conventions

- **Files and Directories**:
  - ✅ DO: Use **kebab-case** for all file names: `list-tasks.js`, `set-task-status.js`
  - ✅ DO: Use consistent directory structure: `mcp-server/src/tools/` for tool definitions, `mcp-server/src/core/direct-functions/` for direct function implementations

- **JavaScript Functions**:
  - ✅ DO: Use **camelCase** with `Direct` suffix for direct function implementations: `listTasksDirect`, `nextTaskDirect`
  - ✅ DO: Use **camelCase** with `Tool` suffix for tool registration functions: `registerListTasksTool`, `registerSetTaskStatusTool`
  - ✅ DO: Use consistent action function naming inside direct functions: `coreActionFn` or similar descriptive name

- **MCP Tool Names**:
  - ✅ DO: Use **snake_case** for tool names exposed to MCP clients: `list_tasks`, `set_task_status`, `parse_prd_document`
  - ✅ DO: Include the core action in the tool name without redundant words: Use `list_tasks` instead of `list_all_tasks`

- **Examples**:
  - File: `list-tasks.js` 
  - Direct Function: `listTasksDirect`
  - Tool Registration: `registerListTasksTool`
  - MCP Tool Name: `list_tasks`

- **Mapping**:
  - The `directFunctions` map in `taskgraph-core.js` maps the core function name (in camelCase) to its direct implementation:
    ```javascript
    export const directFunctions = {
      list: listTasksDirect,
      next: nextTaskDirect,
      // Add more functions as implemented
    };
    ```

## Telemetry Integration

- Direct functions calling core logic that involves AI should receive and pass through `telemetryData` within their successful `data` payload. See `telemetry.md` for the standard pattern.
- MCP tools use `handleApiResult`, which ensures the `data` object (potentially including `telemetryData`) from the direct function is correctly included in the final response.
