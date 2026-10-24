---
description: Guidelines for integrating AI usage telemetry across TaskGraph.
paths:
  - "scripts/modules/**/*.js"
  - "apps/mcp/src/**/*.ts"
---

# AI Usage Telemetry Integration

This document outlines the standard pattern for capturing, propagating, and handling AI usage telemetry data (cost, tokens, model, etc.) across the TaskGraph stack. This ensures consistent telemetry for both CLI and MCP interactions.

## Overview

Telemetry data is generated within the unified AI service layer ([`ai-services-unified.js`](../../scripts/modules/ai-services-unified.js)) and then passed upwards through the calling functions.

- **Data Source**: [`ai-services-unified.js`](../../scripts/modules/ai-services-unified.js) (specifically its `generateTextService`, `generateObjectService`, etc.) returns an object like `{ mainResult: AI_CALL_OUTPUT, telemetryData: TELEMETRY_OBJECT }`.
- **`telemetryData` Object Structure**:
  ```json
  {
    "timestamp": "ISO_STRING_DATE",
    "userId": "USER_ID_FROM_CONFIG",
    "commandName": "invoking_command_or_tool_name",
    "modelUsed": "ai_model_id",
    "providerName": "ai_provider_name",
    "inputTokens": NUMBER,
    "outputTokens": NUMBER,
    "totalTokens": NUMBER,
    "totalCost": NUMBER, // e.g., 0.012414
    "currency": "USD" // e.g., "USD"
  }
  ```

## Integration Pattern by Layer

The key principle is that each layer receives telemetry data from the layer below it (if applicable) and passes it to the layer above it, or handles it for display in the case of the CLI.

### 1. Core Logic Functions (e.g., in `scripts/modules/task-manager/`)

Functions in this layer that invoke AI services are responsible for handling the `telemetryData` they receive from [`ai-services-unified.js`](../../scripts/modules/ai-services-unified.js).

- **Actions**:
    1.  Call the appropriate AI service function (e.g., `generateObjectService`).
        -   Pass `commandName` (e.g., `add-task`, `expand-task`) and `outputType` (e.g., `cli` or `mcp`) in the `params` object to the AI service. The `outputType` can be derived from context (e.g., presence of `mcpLog`).
    2.  The AI service returns an object, e.g., `aiServiceResponse = { mainResult: {/*AI output*/}, telemetryData: {/*telemetry data*/} }`.
    3.  Extract `aiServiceResponse.mainResult` for the core processing.
    4.  **Must return an object that includes `aiServiceResponse.telemetryData`**.
        Example: `return { operationSpecificData: /*...*/, telemetryData: aiServiceResponse.telemetryData };`

- **CLI Output Handling (If Applicable)**:
    -   If the core function also handles CLI output (e.g., it has an `outputFormat` parameter that can be `'text'` or `'cli'`):
        1.  Check if `outputFormat === 'text'` (or `'cli'`).
        2.  If so, and if `aiServiceResponse.telemetryData` is available, print `ui.formatUsageLine(aiServiceResponse.telemetryData)` from `@tm/cli` (muted, on its own line).
        - This ensures telemetry is displayed directly to CLI users after the main command output.

- **Example Snippet (Core Logic in `scripts/modules/task-manager/someAiAction.js`)**:
  ```javascript
  import { generateObjectService } from '../ai-services-unified.js';
  import { ui } from '@tm/cli';

  async function performAiRelatedAction(params, context, outputFormat = 'text') {
    const { commandNameFromContext, /* other context vars */ } = context;
    let aiServiceResponse = null;

    try {
      aiServiceResponse = await generateObjectService({
        // ... other parameters for AI service ...
        commandName: commandNameFromContext || 'default-action-name',
        outputType: context.mcpLog ? 'mcp' : 'cli' // Derive outputType
      });

      const usefulAiOutput = aiServiceResponse.mainResult.object;
      // ... do work with usefulAiOutput ...

      if (outputFormat === 'text' && aiServiceResponse.telemetryData) {
        const usage = ui.formatUsageLine(aiServiceResponse.telemetryData);
        if (usage) console.log(`\n${ui.theme.muted(usage)}`);
      }

      return {
        actionData: /* results of processing */,
        telemetryData: aiServiceResponse.telemetryData
      };
    } catch (error) {
      // ... handle error ...
      throw error;
    }
  }
  ```

### 2. MCP Tools (in `apps/mcp/src/tools/`)

These are the exposed endpoints for MCP clients. A tool calls a tm-core method, whose result carries the `telemetryData` of its AI call, and puts that `telemetryData` in the reply's `data` next to the result (see `apps/mcp/src/tools/tasks/research.tool.ts`).

- **Example Snippet**:
  ```typescript
  execute: withToolContext(
    async (args: z.infer<typeof SomeAiActionSchema>, context: ToolContext) =>
      replyWith(args, context, 'Error running some_ai_action', async () => {
        const result = await context.tmCore.tasks.someAiAction(args.id, {
          tag: args.tag
        });
        return {
          tag: result.tag,
          data: {
            operationSpecificData: result.actionData,
            telemetryData: result.telemetryData
          }
        };
      })
  )
  ```
- `replyWith` (and `handleApiResult` under it) put `data` in the reply unchanged, so the client gets `{ data: { ..., telemetryData }, version, tag }`.

### 3. CLI Commands (`apps/cli/src/commands/`)

These define the command-line interface.

- **Actions**:
    1.  Call the appropriate core logic function.
    2.  Pass `outputFormat: 'text'` (or ensure the core function defaults to text-based output for CLI).
    3.  The core logic function (as per Section 1) is responsible for printing the usage line if telemetry data is available and it's in CLI mode.
    4.  The command action itself **should not** print the usage line if the core logic function already handles this. This avoids duplicate display.

- **Example Snippet (CLI command)**:
  ```javascript
  import { performAiRelatedAction } from './task-manager/someAiAction.js'; // Core function

  programInstance
    .command('some-cli-ai-action')
    // ... .option() ...
    .action(async (options) => {
      try {
        const projectRoot = findProjectRoot() || '.'; // Example root finding
        // ... prepare parameters for core function from command options ...
        await performAiRelatedAction(
          { /* parameters for core function */ },
          { // Context for core function
            projectRoot,
            commandNameFromContext: 'some-cli-ai-action',
            outputType: 'cli'
          },
          'text' // Explicitly request text output format for CLI
        );
        // Core function prints the usage line itself for 'text' outputFormat
      } catch (error) {
        // ... error handling ...
      }
    });
  ```

## Summary Flow

The telemetry data flows as follows:

1.  **[`ai-services-unified.js`](../../scripts/modules/ai-services-unified.js)**: Generates `telemetryData` and returns `{ mainResult, telemetryData }`.
2.  **Core Logic Function**:
    *   Receives `{ mainResult, telemetryData }`.
    *   Uses `mainResult`.
    *   If CLI (`outputFormat: 'text'`), prints `ui.formatUsageLine(telemetryData)`.
    *   Returns `{ operationSpecificData, telemetryData }`.
3.  **MCP Tool**:
    *   Receives the tm-core result and replies `{ data: { operationSpecificData, telemetryData }, version, tag }` through `replyWith` or `handleApiResult`.
4.  **CLI Command**:
    *   Calls core logic with `outputFormat: 'text'`. Display is handled by core logic.

This pattern ensures telemetry is captured and appropriately handled/exposed across all interaction modes.
