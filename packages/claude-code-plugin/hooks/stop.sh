#!/bin/sh
# Stop hook: once per session, reminds Claude to log a note on the task in
# progress when it has none since the session started (the marker
# session-start.sh writes). Exit 2 hands the reminder to Claude.

d="${TASKGRAPH_PROJECT_ROOT:-${CLAUDE_PROJECT_DIR:-$PWD}}"
[ -f "$d/.taskgraph/config.json" ] || [ -f "$d/.taskgraph/tasks/tasks.json" ] || exit 0

in=
while IFS= read -r l || [ -n "$l" ]; do in="$in$l"; done
case "$in" in
	*'"stop_hook_active":true'*) exit 0 ;;
	*'"session_id":"'*) sid=${in#*\"session_id\":\"}; sid=${sid%%\"*} ;;
	*) exit 0 ;;
esac
case "$sid" in '' | *[!A-Za-z0-9_-]*) exit 0 ;; esac

t="${TMPDIR:-/tmp}/taskgraph-$(id -u 2>/dev/null)"
[ -d "$t" ] && [ ! -L "$t" ] && [ -O "$t" ] || exit 0
m="$t/session-$sid"
[ -f "$m" ] || exit 0
since=
shown=
{ read -r since; read -r shown; } < "$m"
[ -n "$since" ] && [ -z "$shown" ] || exit 0

command -v taskgraph >/dev/null 2>&1 || exit 0
export TASKGRAPH_SKIP_AUTO_UPDATE=1
msg=$(taskgraph prime --project "$d" --unnoted-since "$since" 2>/dev/null) || exit 0
[ -n "$msg" ] || exit 0
{ echo shown >> "$m"; } 2>/dev/null || exit 0
printf '%s\n' "$msg" >&2
exit 2
