# Configuration

Taskmaster uses two primary methods for configuration:

1.  **`.taskmaster/config.json` File (Recommended - New Structure)**

    - This JSON file stores most configuration settings, including AI model selections, parameters, logging levels, and project defaults.
    - **Location:** This file is created in the `.taskmaster/` directory when you run the `taskgraph models --setup` interactive setup or initialize a new project with `taskgraph init`.
    - **Migration:** Existing projects with `.taskmasterconfig` in the root will continue to work, but should be migrated to the new structure using `taskgraph migrate`.
    - **Management:** Use the `taskgraph models --setup` command (or `models` MCP tool) to interactively create and manage this file. You can also set specific models directly using `taskgraph models --set-<role>=<model_id>`, adding `--ollama` or `--openrouter` flags for custom models. Manual editing is possible but not recommended unless you understand the structure.
    - **Example Structure:**
      ```json
      {
        "models": {
          "main": {
            "provider": "anthropic",
            "modelId": "claude-sonnet-5-5",
            "maxTokens": 64000,
            "temperature": 0.2,
            "baseURL": "https://api.anthropic.com/v1"
          },
          "research": {
            "provider": "perplexity",
            "modelId": "sonar-pro",
            "maxTokens": 8700,
            "temperature": 0.1,
            "baseURL": "https://api.perplexity.ai/v1"
          },
          "fallback": {
            "provider": "anthropic",
            "modelId": "claude-sonnet-5-5",
            "maxTokens": 64000,
            "temperature": 0.2
          }
        },
        "global": {
          "logLevel": "info",
          "debug": false,
          "defaultNumTasks": 10,
          "defaultSubtasks": 5,
          "defaultPriority": "medium",
          "defaultTag": "master",
          "projectName": "Your Project Name",
          "ollamaBaseURL": "http://localhost:11434/api",
          "azureBaseURL": "https://your-endpoint.azure.com/openai/deployments",
          "vertexProjectId": "your-gcp-project-id",
          "vertexLocation": "us-central1",
	      "responseLanguage": "English"
        }
      }
      ```

> For MCP-specific setup and troubleshooting, see [Provider-Specific Configuration](#provider-specific-configuration).

2.  **Legacy `.taskmasterconfig` File (Backward Compatibility)**

    - For projects that haven't migrated to the new structure yet.
    - **Location:** Project root directory.
    - **Migration:** Use `taskgraph migrate` to move this to `.taskmaster/config.json`.
    - **Deprecation:** While still supported, you'll see warnings encouraging migration to the new structure.

## MCP Tool Loading Configuration

### TASK_MASTER_TOOLS Environment Variable

The `TASK_MASTER_TOOLS` environment variable controls which tools are loaded by the Task Master MCP server. This allows you to optimize token usage based on your workflow needs.

> Note
> Prefer setting `TASK_MASTER_TOOLS` in your MCP client's `env` block (e.g., `.mcp.json`) or in CI/deployment env. The `.env` file is reserved for API keys/endpoints; avoid persisting non-secret settings there.

#### Configuration Options

- **`core`** (default, or `lean`): Loads 7 essential tools (~5,000 tokens, 70% reduction)
  - Best for: Daily development with minimal token overhead
  - Tools included: `get_tasks`, `next_task`, `get_task`, `set_task_status`, `update_subtask`, `parse_prd`, `expand_task`
  - Use when: Working in large contexts where token usage is critical
  - Note: "lean" is an alias for "core" (same tools)

- **`standard`**: Loads 15 commonly used tools (~10,000 tokens, 50% reduction)
  - Best for: Regular task management workflows
  - Tools included: All core tools plus project initialization, complexity analysis, task generation, and more
  - Use when: You need a balanced set of features with reduced token usage

- **`all`**: Loads all 36 available tools (~21,000 tokens)
  - Best for: Users who need the complete feature set
  - Use when: Working with complex projects requiring all Task Master features

- **Custom list**: Comma-separated list of specific tool names
  - Best for: Specialized workflows requiring specific tools
  - Example: `"get_tasks,next_task,set_task_status"`
  - Use when: You know exactly which tools you need

#### How to Configure

1. **In MCP configuration files** (`.mcp.json`) - **Recommended**:

   ```jsonc
   {
     "mcpServers": {
       "taskgraph-ai": {
         "env": {
           "TASK_MASTER_TOOLS": "standard",  // Set tool loading mode
           // API keys can still use .env for security
         }
       }
     }
   }
   ```

2. **Via Claude Code CLI**:

   ```bash
   claude mcp add taskgraph-ai --scope user \
     --env TASK_MASTER_TOOLS="core" \
     -- npx -y taskgraph-ai@latest
   ```

3. **In CI/deployment environment variables**:
   ```bash
   export TASK_MASTER_TOOLS="standard"
   node mcp-server/server.js
   ```

#### Tool Loading Behavior

- When `TASK_MASTER_TOOLS` is unset or empty, the system defaults to `"core"`
- Invalid tool names in a user-specified list are ignored (a warning is emitted for each)
- If every tool name in a custom list is invalid, the system falls back to `"all"`
- Tool names are case-insensitive (e.g., `"CORE"`, `"core"`, and `"Core"` are treated identically)

## Environment Variables (`.env` file or MCP `env` block - For API Keys Only)

- Used **exclusively** for sensitive API keys and specific endpoint URLs.
- **Location:**
  - For CLI usage: Create a `.env` file in your project root.
  - For MCP usage: Configure keys in the `env` section of your `.mcp.json` file.
- **Required API Keys (Depending on configured providers):**
  - `ANTHROPIC_API_KEY`: Your Anthropic API key.
  - `PERPLEXITY_API_KEY`: Your Perplexity API key.
  - `OPENAI_API_KEY`: Your OpenAI API key.
  - `GOOGLE_API_KEY`: Your Google API key (also used for Vertex AI provider).
  - `MISTRAL_API_KEY`: Your Mistral API key.
  - `AZURE_OPENAI_API_KEY`: Your Azure OpenAI API key (also requires `AZURE_OPENAI_ENDPOINT`).
  - `OPENROUTER_API_KEY`: Your OpenRouter API key.
  - `XAI_API_KEY`: Your X-AI API key.
- **Optional Endpoint Overrides:**
  - **Per-role `baseURL` in `.taskmasterconfig`:** You can add a `baseURL` property to any model role (`main`, `research`, `fallback`) to override the default API endpoint for that provider. If omitted, the provider's standard endpoint is used.
  - **Environment Variable Overrides (`<PROVIDER>_BASE_URL`):** For greater flexibility, especially with third-party services, you can set an environment variable like `OPENAI_BASE_URL` or `MISTRAL_BASE_URL`. This will override any `baseURL` set in the configuration file for that provider. This is the recommended way to connect to OpenAI-compatible APIs.
  - `AZURE_OPENAI_ENDPOINT`: Required if using Azure OpenAI key (can also be set as `baseURL` for the Azure model role).
  - `OLLAMA_BASE_URL`: Override the default Ollama API URL (Default: `http://localhost:11434/api`).
  - `VERTEX_PROJECT_ID`: Your Google Cloud project ID for Vertex AI. Required when using the 'vertex' provider.
  - `VERTEX_LOCATION`: Google Cloud region for Vertex AI (e.g., 'us-central1'). Default is 'us-central1'.
  - `GOOGLE_APPLICATION_CREDENTIALS`: Path to service account credentials JSON file for Google Cloud auth (alternative to API key for Vertex AI).

**Important:** Settings like model ID selections (`main`, `research`, `fallback`), `maxTokens`, `temperature`, `logLevel`, `defaultSubtasks`, `defaultPriority`, and `projectName` are **managed in `.taskmaster/config.json`** (or `.taskmasterconfig` for unmigrated projects), not environment variables.

## Tagged Task Lists Configuration (v0.17+)

Taskmaster includes a tagged task lists system for multi-context task management.

### Global Tag Settings

```json
"global": {
  "defaultTag": "master"
}
```

- **`defaultTag`** (string): Default tag context for new operations (default: "master")

### Git Integration

Task Master provides manual git integration through the `--from-branch` option:

- **Manual Tag Creation**: Use `taskgraph add-tag --from-branch` to create a tag based on your current git branch name
- **User Control**: No automatic tag switching - you control when and how tags are created
- **Flexible Workflow**: Supports any git workflow without imposing rigid branch-tag mappings

## State Management File

Taskmaster uses `.taskmaster/state.json` to track tagged system runtime information:

```json
{
  "currentTag": "master",
  "lastSwitched": "2025-06-11T20:26:12.598Z",
  "migrationNoticeShown": true
}
```

- **`currentTag`**: Currently active tag context
- **`lastSwitched`**: Timestamp of last tag switch
- **`migrationNoticeShown`**: Whether migration notice has been displayed

This file is automatically created during tagged system migration and should not be manually edited.

## Example `.env` File (for API Keys)

```
# Required API keys for providers configured in .taskmaster/config.json
ANTHROPIC_API_KEY=sk-ant-api03-your-key-here
PERPLEXITY_API_KEY=pplx-your-key-here
# OPENAI_API_KEY=sk-your-key-here
# GOOGLE_API_KEY=AIzaSy...
# AZURE_OPENAI_API_KEY=your-azure-openai-api-key-here
# etc.

# Optional Endpoint Overrides
# Use a specific provider's base URL, e.g., for an OpenAI-compatible API
# OPENAI_BASE_URL=https://api.third-party.com/v1
#
# Azure OpenAI Configuration
# AZURE_OPENAI_ENDPOINT=https://your-resource-name.openai.azure.com/ or https://your-endpoint-name.cognitiveservices.azure.com/openai/deployments
# OLLAMA_BASE_URL=http://custom-ollama-host:11434/api

# Google Vertex AI Configuration (Required if using 'vertex' provider)
# VERTEX_PROJECT_ID=your-gcp-project-id
```

## Troubleshooting

### Configuration Errors

- If Task Master reports errors about missing configuration or cannot find the config file, run `taskgraph models --setup` in your project root to create or repair the file.
- For new projects, config will be created at `.taskmaster/config.json`. For legacy projects, you may want to use `taskgraph migrate` to move to the new structure.
- Ensure API keys are correctly placed in your `.env` file (for CLI) or `.mcp.json` (for MCP) and are valid for the providers selected in your config file.

### If `taskgraph init` doesn't respond:

Try running it with Node directly:

```bash
node node_modules/claude-task-master/scripts/init.js
```

Or clone the repository and run:

```bash
git clone https://github.com/eyaltoledano/claude-task-master.git
cd claude-task-master
node scripts/init.js
```

## MCP Server Configuration

### MCP Timeout Configuration

Long-running AI operations in taskmaster-ai can exceed the default 60-second MCP timeout. Operations like `parse_prd`, `expand_task`, `research`, and `analyze_project_complexity` may take 2-5 minutes to complete.

#### Adding Timeout Configuration

Add a `timeout` parameter to your MCP configuration to extend the timeout limit. Claude Code reads it from your `.mcp.json`:

```json
{
  "mcpServers": {
    "taskgraph-ai": {
      "command": "npx",
      "args": ["-y", "--package=taskgraph-ai", "taskgraph-ai"],
      "timeout": 300,
      "env": {
        "ANTHROPIC_API_KEY": "your-anthropic-api-key"
      }
    }
  }
}
```

**Configuration Details:**
- **`timeout: 300`** - Sets timeout to 300 seconds (5 minutes)
- **Value range**: 1-3600 seconds (1 second to 1 hour)
- **Recommended**: 300 seconds provides sufficient time for most AI operations
- **Format**: Integer value in seconds (not milliseconds)

#### Troubleshooting Timeouts

If you're still experiencing timeout errors:

1. **Verify configuration**: Check that `timeout: 300` is present in your MCP config
2. **Restart Claude Code**: Restart Claude Code after making configuration changes
3. **Increase timeout**: For very complex operations, try `timeout: 600` (10 minutes)
4. **Check API keys**: Ensure required API keys are properly configured

**Expected behavior:**
- **Before fix**: Operations fail after 60 seconds with `MCP request timed out after 60000ms`
- **After fix**: Operations complete successfully within the configured timeout limit
