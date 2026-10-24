#!/usr/bin/env bash
# Install the package the way a user gets it and run the CLI from it.
#
#   pack-smoke.sh [repo-root]
#
# Packs <repo-root> (default: the current directory, with a built dist/),
# installs the tarball into a new temp project, checks the install against the
# size budget in check-install-size.mjs, and runs init, add-task, list and next
# there through the installed `taskgraph` bin. A file missing from "files", a
# broken bin or a heavy new dependency fails here instead of after a release.
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
node "$root/.github/scripts/check-install-size.mjs" node_modules

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
run next --format json | tee next.json

# next must hand back the task add-task just created
if ! grep -q "Write the README" next.json; then
	echo "next did not return the new task" >&2
	exit 1
fi
echo
echo "Packed CLI works"
