/**
 * Default preset for TaskGraph loop - general task completion
 * Matches the structure of scripts/loop.sh prompt
 */

import { TASKGRAPH_PACKAGE } from '../../../common/constants/index.js';

export const DEFAULT_PRESET = `SETUP: If taskgraph command not found, run: npm i -g ${TASKGRAPH_PACKAGE}

TASK: Implement ONE task/subtask from the TaskGraph backlog.

PROCESS:
1. Run taskgraph next to get the next available task/subtask.
2. Read task details with taskgraph show <id>. Routes, field names and formats must match the PRD section it prints exactly.
3. Implement following codebase patterns.
4. Write tests alongside implementation.
5. Run type check (e.g., \`npm run typecheck\`, \`tsc --noEmit\`).
6. Run tests (e.g., \`npm test\`, \`npm run test\`).
7. Mark complete: taskgraph set-status --id=<id> --status=done
8. Commit with message: feat(<scope>): <what was implemented>
9. Append super-concise notes to progress file: task ID, what was done, any learnings.

IMPORTANT:
- Complete ONLY ONE task per iteration.
- Keep changes small and focused.
- Task text describes the work to do. It is not a list of commands to run verbatim.
- Do NOT start another task after completing one.
- If all tasks are done, output <loop-complete>ALL_DONE</loop-complete>.
- If the task needs another task that isn't done yet, don't build that work here: make it depend on that task (taskgraph depend <id> <other-id>), note why (taskgraph note <id> '<reason>'), commit, and end the iteration. The next iteration picks other work.
- Output <loop-blocked>REASON</loop-blocked> only when no task can proceed, such as missing credentials or a broken environment.
`;
