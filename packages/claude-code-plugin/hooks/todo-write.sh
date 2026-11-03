#!/bin/sh
# PostToolUse hook for TodoWrite: hands Claude Code's todo list to
# `taskgraph log-todos`, which logs it as one note on the task in progress
# once every item is completed. Prints nothing and never blocks.

d="${TASKGRAPH_PROJECT_ROOT:-${CLAUDE_PROJECT_DIR:-$PWD}}"
[ -f "$d/.taskgraph/config.json" ] || [ -f "$d/.taskgraph/tasks/tasks.json" ] || exit 0
# Skip starting the CLI when no task is in progress to log it on
f="$d/.taskgraph/tasks/tasks.json"
[ -f "$f" ] && ! grep -q '"in-progress"' "$f" && exit 0
command -v taskgraph >/dev/null 2>&1 || exit 0
export TASKGRAPH_SKIP_AUTO_UPDATE=1
# A CLI without log-todos fails on it, quietly
taskgraph log-todos --project "$d" >/dev/null 2>&1
exit 0
