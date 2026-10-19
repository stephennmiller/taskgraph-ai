---
description: "Quick install TaskGraph globally if not already installed."
---

Quick install TaskGraph globally if not already installed.

Execute this streamlined installation:

```bash
# Check and install in one command
taskgraph --version 2>/dev/null || npm install -g taskgraph-ai

# Verify installation
taskgraph --version

# Quick setup check
taskgraph models || echo "Note: TaskGraph uses Claude Code; make sure it is installed and signed in"
```

If you see "command not found" after installation, you may need to:
1. Restart your terminal
2. Or add npm global bin to PATH: `export PATH=$(npm bin -g):$PATH`

Once installed, you can use all the TaskGraph commands!

Quick test: Run `/project:help` to see all available commands.