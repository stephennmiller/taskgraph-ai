---
description: "View current AI model configuration."
---

View current AI model configuration.

## Model Configuration Display

Shows the currently configured AI providers and models for TaskGraph.

## Execution

```bash
taskgraph models
```

## Information Displayed

1. **Main Provider**
   - Model ID and name
   - Usage: Primary task generation

2. **Research Provider**
   - Model ID and name
   - Usage: Enhanced research mode

3. **Fallback Provider**
   - Model ID and name
   - Usage: Backup when main fails

## Visual Status

```
TaskGraph Model Configuration
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Main:     ✅ claude-code / sonnet
Research: ✅ claude-code / sonnet
Fallback: ✅ claude-code / sonnet

Available Models:
- opus
- sonnet
- haiku
```

## Next Actions

Based on configuration:
- If Claude Code is missing → Suggest installing and signing in
- If no research model → Explain benefits
- If all configured → Show usage tips
