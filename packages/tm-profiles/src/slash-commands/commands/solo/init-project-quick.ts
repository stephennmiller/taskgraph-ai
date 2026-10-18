/**
 * @fileoverview Init Project Quick Slash Command
 * Quick initialization with auto-confirmation.
 */

import { dynamicCommand } from '../../factories.js';

/**
 * The init-project-quick slash command - Init Project Quick
 *
 * Quick initialization with auto-confirmation.
 */
export const initProjectQuick = dynamicCommand(
	'init-project-quick',
	'Init Project Quick',
	'[prd-file]',
	`Quick initialization with auto-confirmation.

Arguments: $ARGUMENTS

Initialize a TaskGraph project without prompts, accepting all defaults.

## Quick Setup

\`\`\`bash
taskgraph init -y
\`\`\`

## What It Does

1. Creates \`.taskgraph/\` directory structure
2. Initializes empty \`tasks.json\`
3. Sets up default configuration
4. Uses directory name as project name
5. Skips all confirmation prompts

## Smart Defaults

- Project name: Current directory name
- Description: "TaskGraph Project"
- Model config: Existing environment vars
- Task structure: Standard format

## Next Steps

After quick init:
1. Configure AI models if needed:
   \`\`\`
   /taskgraph:models/setup
   \`\`\`

2. Parse PRD if available:
   \`\`\`
   /taskgraph:parse-prd <file>
   \`\`\`

3. Or create first task:
   \`\`\`
   /taskgraph:add-task create initial setup
   \`\`\`

Perfect for rapid project setup!`
);
