/**
 * @fileoverview Quick Install TaskMaster Slash Command
 * Quick install Task Master globally if not already installed.
 */

import { staticCommand } from '../../factories.js';

/**
 * The quick-install-taskmaster slash command - Quick Install TaskMaster
 *
 * Quick install Task Master globally if not already installed.
 */
export const quickInstallTaskmaster = staticCommand({
	name: 'quick-install-taskmaster',
	description: 'Quick Install TaskMaster',
	content: `Quick install Task Master globally if not already installed.

Execute this streamlined installation:

\`\`\`bash
# Check and install in one command
taskgraph --version 2>/dev/null || npm install -g taskgraph-ai

# Verify installation
taskgraph --version

# Quick setup check
taskgraph models --status || echo "Note: You'll need to set up an AI provider API key"
\`\`\`

If you see "command not found" after installation, you may need to:
1. Restart your terminal
2. Or add npm global bin to PATH: \`export PATH=$(npm bin -g):$PATH\`

Once installed, you can use all the Task Master commands!

Quick test: Run \`/taskmaster:help\` to see all available commands.`,
	mode: 'solo'
});
