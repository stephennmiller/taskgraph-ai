#!/usr/bin/env bash
# Install the package the way a user gets it and run the CLI from it.
#
#   pack-smoke.sh [repo-root]
#
# Packs <repo-root> (default: the current directory, with a built dist/),
# installs the tarball into a new temp project, and runs init, add-task, list
# and next there through the installed `taskgraph` bin. A file missing from
# "files" or a broken bin fails here instead of after a release.
set -euo pipefail

root=$(cd "${1:-.}" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

echo "Packing $root"
tarball=$(cd "$root" && npm pack --silent --pack-destination "$work" | tail -n 1)

mkdir "$work/project"
cd "$work/project"
npm init -y >/dev/null
npm install --no-audit --no-fund "$work/$tarball"

export TASKGRAPH_SKIP_AUTO_UPDATE=1
run() {
	echo
	echo "\$ taskgraph $*"
	npx --no-install taskgraph "$@"
}

run --version
run init --yes
run add-task --title="Write the README" --description="Say what the tool does"
run list
run next --json >next.json
cat next.json

# next must hand back the task add-task just created
node -e '
const out = JSON.parse(require("node:fs").readFileSync("next.json", "utf8"));
const title = JSON.stringify(out).includes("Write the README");
if (!title) { console.error("next did not return the new task"); process.exit(1); }
'
echo
echo "Packed CLI works"
