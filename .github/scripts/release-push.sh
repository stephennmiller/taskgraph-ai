#!/bin/sh
# Pushes the release commit and $TAG to main in one atomic push. If main moved
# past $TESTED_SHA while the job ran, the push is rejected; that newer commit's
# own run releases these commits too, so skip instead of failing (#714).
# Writes pushed=true|false to $GITHUB_OUTPUT.
set -u

if git push --atomic origin HEAD:main "$TAG"; then
	echo "pushed=true" >>"$GITHUB_OUTPUT"
	exit 0
fi

remote=$(git ls-remote origin refs/heads/main | cut -f1)
if [ -n "$remote" ] && [ "$remote" != "$TESTED_SHA" ]; then
	echo "::notice::main moved from $TESTED_SHA to $remote; its run will release."
	echo "pushed=false" >>"$GITHUB_OUTPUT"
	exit 0
fi
exit 1
