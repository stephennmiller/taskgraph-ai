# Models

TaskGraph runs every AI call through Claude Code, so it uses Claude Code's three models. There are no provider accounts or per-token prices to manage; usage counts against your Claude Code plan or `CLAUDE_CODE_API_KEY`.

| Model | |
| --- | --- |
| `opus` | Most capable |
| `sonnet` | Balanced; the default for every role |
| `haiku` | Fastest |

Each of TaskGraph's three roles uses one of them:

| Role | Used for |
| --- | --- |
| `main` | Creating and updating tasks |
| `research` | `research` and `--research` runs. It has web search and fetch, and no access to your files |
| `fallback` | Retrying a call when the main model fails |

## Changing models

```bash
taskgraph models                      # show what each role uses
taskgraph models --setup              # pick for each role
taskgraph models --set-main opus      # or set one directly
taskgraph models --set-research opus
taskgraph models --set-fallback haiku
```

In Claude Code you can also say "Change the main model to opus".

What each role is allowed to read and run is described in the [Claude Code guide](https://myself-fcf8480c.mintlify.site/capabilities/claude-code#what-ai-calls-can-access).
