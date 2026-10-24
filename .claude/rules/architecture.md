---
description: Describes the high-level architecture of the TaskGraph CLI application.
paths:
  - "scripts/modules/*.js"
---
# Application Architecture Overview

- **Modular Structure**: The TaskGraph CLI is built using a modular architecture, with distinct modules responsible for different aspects of the application. This promotes separation of concerns, maintainability, and testability.

- **Main Modules and Responsibilities**:

  - **[`apps/cli`](../../apps/cli/src/): Command Handling**
    - **Purpose**: Defines the CLI commands (`apps/cli/src/commands/`), registers them ([`command-registry.ts`](../../apps/cli/src/command-registry.ts)) and runs them ([`program.ts`](../../apps/cli/src/program.ts)) using Commander.js.
    - **Responsibilities** (See also: `commands.md`):
      - Parses command-line arguments and options.
      - Invokes `@tm/core`.
      - Handles user input/output for CLI.
      - Implements CLI-specific validation.

  - **[`@tm/core` tasks module](../../packages/tm-core/src/modules/tasks/): Task Data & Core Logic**
    - **Purpose**: Contains core functions for task data manipulation (CRUD), AI interactions, and related logic.
    - **Responsibilities**:
      - Reading/writing `tasks.json` with tagged task lists support.
      - Implementing functions for task CRUD, parsing PRDs, expanding tasks, updating status, etc.
      - **Tagged Task Lists**: Handles task organization across multiple contexts (tags) like "master", branch names, or project phases.
      - **Tag Resolution**: Provides backward compatibility by resolving tagged format to legacy format transparently.
      - **Delegating AI interactions** to the `ai-services-unified.js` layer.
      - Accessing non-AI configuration via `config-manager.js` getters.
    - **Key Files**: Individual files within `scripts/modules/task-manager/` handle specific actions (e.g., `models.js`). `next`, `sync-readme`, `add-task`, `expand`, `parse-prd`, `analyze-complexity`, `research`, `update-task`, `update`, `update-subtask`, `scope-up` and `scope-down` live in `@tm/core` (`tmCore.tasks.*`).

  - **[`modules/dependencies/`](../../packages/tm-core/src/modules/dependencies/) in `@tm/core`: Dependency Management**
    - **Purpose**: Manages task dependencies.
    - **Responsibilities**: Add/remove/validate/fix dependencies across tagged task contexts (`tmCore.tasks.addDependency` and friends).

  - **[`apps/cli/src/ui/`](../../apps/cli/src/ui/): User Interface Components**
    - **Purpose**: Pure formatters (`formatters/*-formatters.ts`), the theme and spinners for CLI output. See `ui.md`.

  - **[`@tm/core` AI service](../../packages/tm-core/src/modules/ai/ai-service.ts): Unified AI Service Layer**
    - **Purpose**: `AiService` runs every LLM call: role-based provider/model selection, fallback, retries, telemetry. Config getters and `log` come from the host.
    - Legacy JS calls it through [`ai-services-unified.js`](../../scripts/modules/ai-services-unified.js) (`generateTextService`, `generateObjectService`), which wires in the legacy config. Telemetry propagates upwards; see `telemetry.md`.

  - **[`@tm/core` AI providers](../../packages/tm-core/src/modules/ai/providers/): Claude Code Provider**
    - **Purpose**: Wraps the Vercel AI SDK with role tool limits and the path guard.
    - **Responsibilities**: Interact directly with Vercel AI SDK adapters.

  - **[`config-manager.js`](../../scripts/modules/config-manager.js): Configuration Management**
    - **Purpose**: Loads, validates, and provides access to configuration.
    - **Responsibilities** (See also: `utilities.md`):
      - Reads and merges `.taskgraph/config.json` with defaults, with the gitignored per-machine `.taskgraph/config.local.json` over it.
      - Provides getters (e.g., `getMainProvider`, `getLogLevel`, `getDefaultNumTasks`) for accessing settings.
      - **Tag Configuration**: Manages `global.defaultTag` and `tags` section for tag system settings.
      - **Note**: Does **not** store or directly handle API keys (keys are in `.env` or MCP `session.env`).

  - **[`utils.js`](../../scripts/modules/utils.js): Core Utility Functions**
    - **Purpose**: Low-level, reusable CLI utilities.
    - **Responsibilities** (See also: `utilities.md`):
      - Logging (`log` function), File I/O (`readJSON`, `writeJSON`), String utils (`truncate`).
      - Task utils (`findTaskById`), Dependency utils (`findCycles`).
      - API Key Resolution (`resolveEnvVariable`).
      - Silent Mode (`enableSilentMode`, which turns `log` off for the rest of the process).
      - **Tagged Task Lists**: Silent migration system, tag resolution, current tag management.
      - **Migration System**: `performCompleteTagMigration`, `migrateConfigJson`, `createStateJson`.

  - **[`apps/mcp/`](../../apps/mcp/) (`@tm/mcp`): MCP Server**
    - **Purpose**: The MCP interface, on FastMCP over stdio; built to `dist/mcp-server.js`.
    - **Responsibilities** (See also: `mcp.md`):
      - `src/server.ts` starts the server; `src/tools/tool-registry.ts` maps tool names to their `register*Tool` functions and holds the tiers `TASKGRAPH_TOOLS` picks.
      - Each tool (`src/tools/<area>/*.tool.ts`) wraps `execute` in `withToolContext`, which normalizes `args.projectRoot` and passes a `tmCore` for it, calls tm-core, and replies through `replyWith` or `handleApiResult`.
      - Tools are thin: no business logic, as for the CLI.

  - **[`modules/init/`](../../packages/tm-core/src/modules/init/) in `@tm/core`: Project Initialization**
    - **Purpose**: `initializeProject` sets up .taskgraph/, templates, the `CLAUDE.md` import (`.mcp.json` only with `--mcp`) and state.json; `apps/cli`'s `init` asks and prints.

## Tagged Task Lists System Architecture

**Data Structure**: TaskGraph now uses a tagged task lists system where the `tasks.json` file contains multiple named task lists as top-level keys:

```json
{
  "master": {
    "tasks": [/* standard task objects */]
  },
  "feature-branch": {
    "tasks": [/* separate task context */]
  }
}
```

**Key Components:**

- **Silent Migration**: Automatically transforms legacy `{"tasks": [...]}` format to tagged format `{"master": {"tasks": [...]}}` on first read
- **Tag Resolution Layer**: Provides 100% backward compatibility by intercepting tagged format and returning legacy format to existing code
- **Configuration Integration**: `global.defaultTag` and `tags` section in config.json manage tag system settings
- **State Management**: `.taskgraph/state.json` tracks current tag, migration status, and tag-branch mappings
- **Migration Notice**: User-friendly notification system for seamless migration experience

**Backward Compatibility**: All existing CLI commands and MCP tools continue to work unchanged. The tag resolution layer ensures that existing code receives the expected legacy format while the underlying storage uses the new tagged structure.

- **Data Flow and Module Dependencies (Updated)**:

  - **CLI**: `scripts/dev.js` (loads `.env`) -> `apps/cli/src/program.ts` -> Command (`apps/cli/src/commands/*`) -> `@tm/core` -> AI Service -> Provider Adapters -> LLM API.
  - **MCP**: External Tool -> `apps/mcp/src/main.ts` (`dist/mcp-server.js`) -> Tool (`apps/mcp/src/tools/*`, via `withToolContext`) -> `@tm/core` (`tmCore.tasks`, `tmCore.config`, ...) -> AI service (`packages/tm-core/src/modules/ai/`) when the tool needs one.
  - **Configuration**: Core logic needing non-AI settings calls `config-manager.js` getters (passing `session.env` via `explicitRoot` if from MCP). Unified AI Service internally calls `config-manager.js` getters (using `role`) for AI params and `utils.js` (`resolveEnvVariable` with `session.env`) for API keys.

## Keeping MCP output off stdout

The MCP server speaks JSON-RPC on stdout, so nothing else may write there. `apps/mcp/src/main.ts` sets `TASKGRAPH_MCP=true`, which keeps tm-core's logger quiet on the console, and the server's own startup log (`apps/mcp/src/logger.ts`) goes to stderr. Inside a tool, log through the context's `log`; `withToolContext` hands tm-core a logger that forwards to it. Never `console.log` from tool or tm-core code the server runs.

- **Testing Architecture**:

  - **Test Organization Structure** (See also: `tests.md`):
    - **Unit Tests**: Located in `tests/unit/`, reflect the module structure with one test file per module
    - **Integration Tests**: Located in `tests/integration/`, test interactions between modules
    - **End-to-End Tests**: Located in `tests/e2e/`, test complete workflows from a user perspective
    - **Test Fixtures**: Located in `tests/fixtures/`, provide reusable test data
    - **Tagged System Tests**: Test migration, tag resolution, and multi-context functionality

  - **Module Design for Testability**:
    - **Explicit Dependencies**: Functions accept their dependencies as parameters rather than using globals
    - **Functional Style**: Pure functions with minimal side effects make testing deterministic
    - **Separate Logic from I/O**: Core business logic is separated from file system operations
    - **Clear Module Interfaces**: Each module has well-defined exports that can be mocked in tests
    - **Callback Isolation**: Callbacks are defined as separate functions for easier testing
    - **Stateless Design**: Modules avoid maintaining internal state where possible
    - **Tag Resolution Testing**: Test both tagged and legacy format handling

  - **Mock Integration Patterns**:
    - **External Libraries**: Libraries like `fs`, `commander`, and `@anthropic-ai/sdk` are mocked at module level
    - **Internal Modules**: Application modules are mocked with appropriate spy functions
    - **Testing Function Callbacks**: Callbacks are extracted from mock call arguments and tested in isolation
    - **Tagged Data Mocking**: Test both legacy and tagged task data structures

  - **Testing Flow**:
    - Module dependencies are mocked (`vi.mock` calls are hoisted above imports by Vitest)
    - Test modules are imported after mocks are established
    - Spy functions are set up on module methods
    - Tests call the functions under test and verify behavior
    - Mocks are reset between test cases to maintain isolation
    - Tagged system behavior is tested for both migration and normal operation

- **Benefits of this Architecture**:

  - **Maintainability**: Modules are self-contained and focused, making it easier to understand, modify, and debug specific features.
  - **Testability**:  Each module can be tested in isolation (unit testing), and interactions between modules can be tested (integration testing).
    - **Mocking Support**: The clear dependency boundaries make mocking straightforward
    - **Test Isolation**: Each component can be tested without affecting others
    - **Callback Testing**: Function callbacks can be extracted and tested independently
    - **Multi-Context Testing**: Tagged system enables testing different task contexts independently
  - **Reusability**: Utility functions and UI components can be reused across different parts of the application.
  - **Scalability**:  New features can be added as new modules or by extending existing ones without significantly impacting other parts of the application.
  - **Multi-Context Support**: Tagged task lists enable working across different contexts (branches, environments, phases) without conflicts.
  - **Backward Compatibility**: Seamless migration and tag resolution ensure existing workflows continue unchanged.
  - **Clarity**: The modular structure provides a clear separation of concerns, making the codebase easier to navigate and understand for developers.

This architectural overview should help AI models understand the structure and organization of the TaskGraph CLI codebase, enabling them to more effectively assist with code generation, modification, and understanding.

## Implementing MCP Support for a Command

Put the logic in a tm-core method, then add a tool in `apps/mcp/src/tools/` that calls it and register it in `toolRegistry` (`apps/mcp/src/tools/tool-registry.ts`). `mcp.md` has the pattern, the tiers and the tests. `.mcp.json` lists no tools, so it needs no change.

## Project Initialization

The `initialize_project` command provides a way to set up a new TaskGraph project:

- **CLI Command**: `taskgraph init`
- **MCP Tool**: `initialize_project`
- **Functionality**:
  - Creates necessary directories and files for a new project
  - Sets up `tasks.json` with tagged structure and initial task files
  - Configures project metadata (name, description, version)
  - Initializes state.json for tag system
  - Handles shell alias creation if requested
  - Works in both interactive and non-interactive modes