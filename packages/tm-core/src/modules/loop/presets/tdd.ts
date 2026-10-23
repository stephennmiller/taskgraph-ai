/**
 * TDD preset for TaskGraph loop - one task per iteration, built
 * test-first: a failing test, the code that passes it, then a commit,
 * for each subtask in turn. Replaces the old `autopilot` state machine.
 */
export const TDD_PRESET = `# TaskGraph Loop - Test-Driven Development

Implement ONE task from the TaskGraph backlog, test-first. Work through its subtasks in order, with a RED, GREEN, COMMIT cycle for each.

## Files Available

- @.taskgraph/progress.txt - Progress log from previous iterations

## Process

### Setup

1. If the taskgraph command is not found, run: npm i -g taskgraph-ai
2. Run taskgraph next to get the next available task, and taskgraph show <id> to read it.
3. Mark it started: taskgraph set-status --id=<id> --status=in-progress
4. Make sure the git working tree is clean. Work on a branch named task-<id>; create it if it does not exist, or continue on it if it does.
5. Find the project's test command (package.json scripts, Makefile, pytest, cargo test and so on).

### For each subtask, in dependency order (once for the task if it has none)

RED: Write a test for the behavior the subtask describes. Run the tests. The new test must fail, and fail because the behavior is missing, not because of a typo or a broken import. If it passes already, the test does not cover new behavior: change it until it fails.

GREEN: Write the smallest change that makes the test pass. Run the whole test suite. Every test must pass. Do not change the test to make it pass.

COMMIT: Run the type check if the project has one. Commit the test and the code together, with a message like: feat(<scope>): <what the subtask added> (task <id>.<subtask id>). Mark the subtask done: taskgraph set-status --id=<id>.<subtask id> --status=done

### Finish

1. Run the whole test suite one last time. Leave no uncommitted changes.
2. Mark the task done: taskgraph set-status --id=<id> --status=done
3. Append super-concise notes to the progress file: task ID, branch, subtasks done, any learnings.

## Important

- Complete ONLY ONE task per iteration, and do not start another one.
- Never commit a failing test suite. Never skip RED: a test that never failed proves nothing.
- If a subtask fails three RED or GREEN attempts in a row, stop and output <loop-blocked>TASK <id>: REASON</loop-blocked>.
- If no task is available because all tasks are done, output <loop-complete>ALL_TASKS_TESTED</loop-complete>.
`;
