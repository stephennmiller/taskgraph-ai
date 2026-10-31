#!/bin/sh
# UserPromptSubmit hook: adds the task in progress and its unchecked criteria
# to each prompt, so a long session keeps it in view. Prints nothing outside a
# TaskGraph project or when no task is in progress.

d="${TASKGRAPH_PROJECT_ROOT:-${CLAUDE_PROJECT_DIR:-$PWD}}"
[ -f "$d/.taskgraph/config.json" ] || [ -f "$d/.taskgraph/tasks/tasks.json" ] || exit 0
# Runs on every prompt, so skip starting the CLI when no task is in progress
f="$d/.taskgraph/tasks/tasks.json"
[ -f "$f" ] && ! grep -q '"in-progress"' "$f" && exit 0
command -v taskgraph >/dev/null 2>&1 || exit 0
export TASKGRAPH_SKIP_AUTO_UPDATE=1
# A CLI without --current fails on it and prints nothing to stdout
taskgraph prime --project "$d" --current 2>/dev/null
exit 0
