#!/usr/bin/env bash
# Compare two builds of the CLI on every scenario in apps/cli/tests/parity/scenarios
# and write one report per scenario plus a summary table.
#
#   run-parity.sh <base-root> <head-root> <reports-dir> [scenarios-dir]
#
# A <root> is a checkout with a built dist/. The scenarios and the comparison
# tool come from <head-root>. Differences between the builds are the point of
# the comparison, so they do not fail this script; a scenario that cannot run
# (exit 2: a bad scenario, or a build that cannot run init) does.
# The summary goes to $GITHUB_STEP_SUMMARY when it is set.
set -uo pipefail

base=$(cd "$1" && pwd)
head_root=$(cd "$2" && pwd)
mkdir -p "$3"
reports=$(cd "$3" && pwd)
scenarios=${4:-$head_root/apps/cli/tests/parity/scenarios}
summary=${GITHUB_STEP_SUMMARY:-/dev/null}
details_lines=60

{
	echo "## Build comparison"
	echo
	echo "The target branch's build (A) against this PR's build (B), on every scenario in \`apps/cli/tests/parity/scenarios\`. A difference is expected when a PR changes behaviour on purpose; read it."
	echo
	echo "| Scenario | Result |"
	echo "| --- | --- |"
} >>"$summary"

failed=0
differing=()
for file in "$scenarios"/*.json; do
	name=$(basename "$file" .json)
	node "$head_root/apps/cli/tests/parity/compare-builds.mjs" \
		--a "node $base/dist/taskgraph.js" \
		--b "node $head_root/dist/taskgraph.js" \
		--scenario "$file" --timeout 120000 >"$reports/$name.txt" 2>&1
	code=$?
	case $code in
	0) result="no differences" ;;
	1)
		result="differences, or a step that did not exit as expected"
		differing+=("$name")
		;;
	*)
		result="could not run (exit $code)"
		failed=1
		differing+=("$name")
		;;
	esac
	echo "| $name | $result |" >>"$summary"
	echo "$name: $result"
done

for name in ${differing[@]+"${differing[@]}"}; do
	{
		echo
		echo "<details><summary>$name</summary>"
		echo
		echo '```'
		head -n "$details_lines" "$reports/$name.txt"
		if [ "$(wc -l <"$reports/$name.txt")" -gt "$details_lines" ]; then
			echo "... (first $details_lines lines; the full report is in the parity-reports artifact)"
		fi
		echo '```'
		echo "</details>"
	} >>"$summary"
done

exit $failed
