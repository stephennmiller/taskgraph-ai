---
description: "Run interactive setup to configure AI models."
---

Run interactive setup to configure AI models.

## Interactive Model Configuration

Guides you through setting up AI providers for TaskGraph.

## Execution

```bash
taskgraph models --setup
```

## Setup Process

1. **Environment Check**
   - Confirm Claude Code is installed and signed in
   - Show current configuration

2. **Model Selection**
   - Choose the main model (required)
   - Choose the research model (recommended)
   - Choose a fallback model (optional)

TaskGraph uses Claude Code, so no API keys are needed. Available models: opus, sonnet, haiku.

## Smart Recommendations

Based on your needs:
- **For best results**: opus for main, sonnet for research
- **Budget conscious**: haiku for fallback
- **Balanced**: sonnet for all roles

## Configuration Storage

Model choices are saved in `.taskgraph/config.json`.

## Post-Setup

After configuration:
- Show usage examples
- Suggest next steps
- Verify parse-prd works
