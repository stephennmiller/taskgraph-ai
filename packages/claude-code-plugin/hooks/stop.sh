#!/bin/sh
# Stop hook. Exit 2 hands the message on stderr to Claude, which keeps going.
# Once per session it reminds Claude to log a note on the task in progress
# when it has none since the session started (the marker session-start.sh
# writes). Otherwise it keeps Claude going while the task in progress has
# unchecked acceptance criteria, once per session for each set of them, so a
# turn that only answers a question doesn't cost another turn each time.
# Never twice in a row: when a stop hook kept Claude going, the next stop
# goes through.

d="${TASKGRAPH_PROJECT_ROOT:-${CLAUDE_PROJECT_DIR:-$PWD}}"
[ -f "$d/.taskgraph/config.json" ] || [ -f "$d/.taskgraph/tasks/tasks.json" ] || exit 0

in=
while IFS= read -r l || [ -n "$l" ]; do in="$in$l"; done
case "$in" in *'"stop_hook_active":true'*) exit 0 ;; esac
# Both checks need a task in progress; skip starting the CLI when none is
f="$d/.taskgraph/tasks/tasks.json"
[ -f "$f" ] && ! grep -q '"in-progress"' "$f" && exit 0
command -v taskgraph >/dev/null 2>&1 || exit 0
export TASKGRAPH_SKIP_AUTO_UPDATE=1

block() {
	printf '%s\n' "$1" >&2
	exit 2
}

case "$in" in
	*'"session_id":"'*) sid=${in#*\"session_id\":\"}; sid=${sid%%\"*} ;;
	*) sid= ;;
esac
case "$sid" in '' | *[!A-Za-z0-9_-]*) sid= ;; esac
t="${TMPDIR:-/tmp}/taskgraph-$(id -u 2>/dev/null)"
# Both checks remember what they said in the private folder, so neither
# blocks without it
[ -n "$sid" ] && [ -d "$t" ] && [ ! -L "$t" ] && [ -O "$t" ] || exit 0
m="$t/session-$sid"
if [ -f "$m" ]; then
	since=
	shown=
	{ read -r since; read -r shown; } < "$m"
	if [ -n "$since" ] && [ -z "$shown" ]; then
		msg=$(taskgraph prime --project "$d" --unnoted-since "$since" 2>/dev/null) || msg=
		# Only block once it's recorded, so a read-only marker can't block every stop
		[ -n "$msg" ] && { echo shown >> "$m"; } 2>/dev/null && block "$msg"
	fi
fi

msg=$(taskgraph prime --project "$d" --unmet-criteria 2>/dev/null) || exit 0
[ -n "$msg" ] || exit 0
# The text names the task and its unchecked criteria: same text, same set
u="$t/unmet-$sid"
[ "$(cat "$u" 2>/dev/null)" = "$msg" ] && exit 0
{ printf '%s\n' "$msg" > "$u"; } 2>/dev/null && block "$msg"
exit 0
