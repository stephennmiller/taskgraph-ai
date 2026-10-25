#!/bin/sh
# SessionStart hook: hands `taskgraph prime` output to Claude, or says what to
# install. Records when the session started, for the Stop hook. Prints nothing
# outside a TaskGraph project, since the plugin installs user-wide.

d="${TASKGRAPH_PROJECT_ROOT:-${CLAUDE_PROJECT_DIR:-$PWD}}"
[ -f "$d/.taskgraph/config.json" ] || [ -f "$d/.taskgraph/tasks/tasks.json" ] || exit 0

in=
while IFS= read -r l || [ -n "$l" ]; do in="$in$l"; done
case "$in" in
	*'"session_id":"'*) sid=${in#*\"session_id\":\"}; sid=${sid%%\"*} ;;
	*) sid= ;;
esac

# A 0700 folder the user owns, so other users on a shared /tmp can't plant or read markers
case "$sid" in
	'' | *[!A-Za-z0-9_-]*) ;;
	*)
		t="${TMPDIR:-/tmp}/taskgraph-$(id -u 2>/dev/null)"
		mkdir -m 700 "$t" 2>/dev/null
		if [ -d "$t" ] && [ ! -L "$t" ] && [ -O "$t" ]; then
			m="$t/session-$sid"
			case "$in" in
				# After compaction keep the original start time
				*'"source":"compact"'*) [ -f "$m" ] || { date -u +%Y-%m-%dT%H:%M:%SZ > "$m"; } 2>/dev/null ;;
				*) { date -u +%Y-%m-%dT%H:%M:%SZ > "$m"; } 2>/dev/null ;;
			esac
		fi
		;;
esac

pre="This project tracks work in TaskGraph, but"
if ! command -v taskgraph >/dev/null 2>&1; then
	echo "$pre the taskgraph CLI is not installed. Ask the user to run: npm install -g taskgraph-ai"
	exit 0
fi
export TASKGRAPH_SKIP_AUTO_UPDATE=1
p="${CLAUDE_PLUGIN_ROOT:-}"
if out=$(taskgraph prime --project "$d" --plugin-root "$p" 2>/dev/null); then
	printf '%s\n' "$out"
else
	out=$(taskgraph prime --project "$d" --plugin-root "$p" 2>&1)
	case "$out" in
		*"nknown command"* | *"nknown option"*) echo "$pre the installed taskgraph CLI is too old for the plugin. Ask the user to run: npm install -g taskgraph-ai@latest" ;;
		*) echo "$pre taskgraph prime failed:"; printf '%s\n' "$out" ;;
	esac
fi
