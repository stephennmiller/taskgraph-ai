/**
 * Default preset for TaskGraph loop: one task per session. Each session starts
 * small, so no call re-reads a long history; on the jq and Shell benchmarks
 * this cost 45% less than one session over every task.
 */

import { TASKGRAPH_PACKAGE } from '../../../common/constants/index.js';

export const DEFAULT_PRESET = `SETUP: If taskgraph command not found, run: npm i -g ${TASKGRAPH_PACKAGE}

TASK: Finish one TaskGraph task in this session, record it, and stop. The loop starts a fresh session for the next task.

PROCESS:
1. Run taskgraph next to pick the task, then taskgraph show <id> for its criteria and the PRD section it prints. Routes, field names and formats must match that section exactly. Read only the code this task touches.
2. Build it the way you would without TaskGraph: write whole files at a time, in as few steps as you can, with tests alongside.
3. When the work is in place, run the type check and tests, then run the app through its real entry point (the CLI, server or UI the PRD describes) on an input this task should handle, and fix what is wrong. If nothing wires this task into the entry point yet and no pending task does, add one (taskgraph add-task --priority=high --title='<wire what into the entry point>' -d '<what and why>').
4. Record it with ONE command, checking off every criterion the task meets:
   git add <the files you changed> && git commit -qm 'feat(<scope>): <what was implemented> [task <id>]' && taskgraph set-status <id> done --check=<criteria numbers, comma-separated, like 1,2,3>
   The tag links the commit to the task in taskgraph show.
5. Stop. If taskgraph next now reports no task left, end with <loop-complete>ALL_DONE</loop-complete>.

IMPORTANT:
- Don't add notes to the progress file or keep design files: the commits and statuses are the record, and the loop logs each session there itself.
- Task text describes the work to do. It is not a list of commands to run verbatim.
- If the task needs another task that isn't done yet, don't build that work here: make it depend on that task (taskgraph depend <id> <other-id>), note why (taskgraph note <id> '<reason>'), and stop.
- Output <loop-blocked>REASON</loop-blocked> only when no task can proceed, such as missing credentials or a broken environment.
`;
