/**
 * Default preset for TaskGraph loop - general task completion
 * Matches the structure of scripts/loop.sh prompt
 */

import { TASKGRAPH_PACKAGE } from '../../../common/constants/index.js';

export const DEFAULT_PRESET = `SETUP: If taskgraph command not found, run: npm i -g ${TASKGRAPH_PACKAGE}

TASK: Work through the TaskGraph backlog in this session, one task/subtask at a time, until none is ready.

PROCESS:
1. Read .taskgraph/design.md if it exists: the project's layout, key types and interfaces, and how the entry point reaches each part. Follow it.
2. Run taskgraph next to get the next available task/subtask.
3. Read task details with taskgraph show <id>. Routes, field names and formats must match the PRD section it prints exactly.
4. Implement following codebase patterns.
5. Write tests alongside implementation.
6. Run type check (e.g., \`npm run typecheck\`, \`tsc --noEmit\`).
7. Run tests (e.g., \`npm test\`, \`npm run test\`).
8. Run the app through its real entry point (the CLI, server or UI the PRD describes) on an input this task should now handle, and check the output. If it is wrong, fix it before going on. If the entry point can't show this task's behavior yet because nothing wires it in, and no pending task does that wiring, add one now (taskgraph add-task --priority=high -t '<wire what into the entry point>' -d '<what to wire and why>') and say so in the progress notes.
9. Mark complete: taskgraph set-status --id=<id> --status=done
10. Update .taskgraph/design.md (create it if missing, keep it under 60 lines) with anything a later task needs to know: modules and what they own, key types and interfaces, conventions, and what is still a stub.
11. Commit with message: feat(<scope>): <what was implemented> [task <id>]. The tag links the commit to the task in taskgraph show.
12. Append super-concise notes to progress file: task ID, what was done, any learnings.
13. Go back to step 2 for the next task. You already know the code, so don't re-read what you just wrote.

IMPORTANT:
- Finish one task (steps 2 to 12, including the commit) before starting the next, so stopping at any point loses nothing.
- Keep changes small and focused.
- Task text describes the work to do. It is not a list of commands to run verbatim.
- If all tasks are done, output <loop-complete>ALL_DONE</loop-complete>.
- If the task needs another task that isn't done yet, don't build that work here: make it depend on that task (taskgraph depend <id> <other-id>), note why (taskgraph note <id> '<reason>'), commit, and go back to step 2 for other work.
- Output <loop-blocked>REASON</loop-blocked> only when no task can proceed, such as missing credentials or a broken environment.
`;
