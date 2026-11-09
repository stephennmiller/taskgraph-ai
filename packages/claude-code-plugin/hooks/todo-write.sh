#!/bin/sh
# PostToolUse hook for TodoWrite, TaskCreate and TaskUpdate: hands Claude
# Code's call to `taskgraph log-todos`, which logs the todo list as one note
# on the task in progress once every item is completed. Prints nothing and
# never blocks.

d="${TASKGRAPH_PROJECT_ROOT:-${CLAUDE_PROJECT_DIR:-$PWD}}"
[ -f "$d/.taskgraph/config.json" ] || [ -f "$d/.taskgraph/tasks/tasks.json" ] || exit 0
in=
while IFS= read -r l || [ -n "$l" ]; do in="$in$l"; done
command -v taskgraph >/dev/null 2>&1 || exit 0
export TASKGRAPH_SKIP_AUTO_UPDATE=1
# The task tools send one task per call, so the CLI keeps the session's list
# in the private folder session-start.sh makes; without it they log nothing
t="${TMPDIR:-/tmp}/taskgraph-$(id -u 2>/dev/null)"
h=
[ -d "$t" ] && [ ! -L "$t" ] && [ -O "$t" ] && h="$t"
f="$d/.taskgraph/tasks/tasks.json"
case "$in" in
	# Every task tool call is kept, even before a task is claimed, or the
	# list would lose the items added before then
	*'"tool_name":"Task'*) [ -n "$h" ] || exit 0 ;;
	# TodoWrite sends the whole list: skip starting the CLI when no task is
	# in progress to log it on
	*) [ -f "$f" ] && ! grep -q '"in-progress"' "$f" && exit 0 ;;
esac
[ -n "$h" ] && export TASKGRAPH_HOOK_DIR="$h"
# A CLI without log-todos fails on it, quietly
printf '%s' "$in" | taskgraph log-todos --project "$d" >/dev/null 2>&1
exit 0
