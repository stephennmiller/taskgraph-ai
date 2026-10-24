/**
 * Pre-commit check: block staged files over MAX_TOKENS (tokens = bytes / 4).
 * Only agent-authored text is checked; lockfiles, generated output, media and
 * other tool-managed files are ignored. Measures the staged blob, not the
 * working tree, so unstaged edits can't hide or trigger a failure.
 */
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const MAX_TOKENS = 5000;
const BYTES_PER_TOKEN = 4;

const IGNORED_PATTERNS = [
	// lockfiles
	/(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|poetry\.lock|Pipfile\.lock|composer\.lock|Gemfile\.lock|go\.sum)$/,
	// generated / codegen / minified / snapshots
	/(^|\/)(dist|build|coverage|generated|__generated__|__snapshots__|node_modules)\//,
	/\.(generated|gen|min)\.[a-z]+$/,
	/\.(snap|map)$/,
	/\.d\.ts$/,
	/(^|\/)[^/]*\.g\.[a-z]+$/,
	// tool-managed files (release automation, taskgraph)
	/(^|\/)CHANGELOG\.md$/,
	/^\.taskgraph\/tasks\//,
	/^\.taskgraph\/reports\//,
	// archived TaskGraph data, kept for history and never edited
	/^\.taskgraph\/archive\//,
	// binary / media
	/\.(png|jpe?g|gif|webp|avif|ico|svg|mp4|mov|webm|mp3|wav|pdf|woff2?|ttf|otf|eot|zip|gz|tgz|wasm)$/i
];

// Legacy root tests that were already over the limit when the Jest -> Vitest
// migration (#71) had to touch them. Exact paths, so new files in the same
// folders are still checked. Remove an entry once its file is split.
const LEGACY_OVERSIZED = new Set([
	'.claude/rules/mcp.md',
	'.claude/rules/utilities.md',
	'scripts/modules/ai-services-unified.js',
	'tests/integration/cli/move-cross-tag.test.js',
	'tests/integration/mcp-server/direct-functions.test.js',
	'tests/integration/move-task-cross-tag.integration.test.js',
	'tests/unit/config-manager.test.js',
	'tests/unit/dependency-manager.test.js',
	'tests/unit/utils.test.js',
	'tests/unit/scripts/modules/task-manager/complexity-report-tag-isolation.test.js',
	'tests/unit/scripts/modules/task-manager/expand-task.test.js',
	'tests/unit/scripts/modules/task-manager/list-tasks.test.js',
	'tests/unit/scripts/modules/task-manager/parse-prd.test.js',
	// Legacy task-manager sources that were already over the limit. Splitting
	// them is its own issue; until then a small edit to one must be committable.
	'scripts/modules/dependency-manager.js',
	'scripts/modules/task-manager/move-task.js',
	'scripts/modules/task-manager/add-task.js',
	'scripts/modules/task-manager/scope-adjustment.js',
	'scripts/modules/utils.js',
	'scripts/modules/task-manager/tag-management.js',
	// Contributor guides that still describe Jest and need a Vitest rewrite (#79).
	'.claude/rules/tests.md',
	'.claude/rules/new-features.md',
	// The legacy CLI command registry, far over the limit. Splitting it is its own
	// task; until then a dependency bump that touches one line must be committable.
	'scripts/modules/commands.js',
	// Over the limit on main; a one-line default or parameter change must be
	// committable until each is split.
	'scripts/modules/config-manager.js',
	'src/prompts/README.md',
	// Over the limit on main; #248 moves two imports in each to load on demand
	'packages/tm-core/src/modules/git/adapters/git-adapter.ts',
	'scripts/modules/utils/contextGatherer.js',
	// Manual prompt test harness (~15,000 tokens on main); a stale parameter
	// removal must be committable until it is split.
	'tests/manual/prompts/prompt-test.js'
]);

export const isIgnored = (path) =>
	LEGACY_OVERSIZED.has(path) || IGNORED_PATTERNS.some((re) => re.test(path));

export const estimateTokens = (bytes) => Math.ceil(bytes / BYTES_PER_TOKEN);

/** @returns {{path: string, tokens: number}[]} staged files over the limit */
export function findOversized(files, readBlob, maxTokens = MAX_TOKENS) {
	const oversized = [];
	for (const path of files) {
		if (isIgnored(path)) continue;
		const blob = readBlob(path);
		if (blob.includes(0)) continue; // binary
		const tokens = estimateTokens(blob.length);
		if (tokens > maxTokens) oversized.push({ path, tokens });
	}
	return oversized;
}

export function formatError(oversized, maxTokens = MAX_TOKENS) {
	const list = oversized
		.map(
			({ path, tokens }) => `  ${path}  (~${tokens} tokens, limit ${maxTokens})`
		)
		.join('\n');
	return `pre-commit: these staged files are too large (tokens = bytes / 4):

${list}

Large files are hard for agents to read and edit. Split each one:

  1. Read the file and list its distinct responsibilities (e.g. types,
     helpers, one class per concern, one test group per behavior).
  2. Create new files next to it, one per responsibility, each well under
     ${maxTokens} tokens (aim for ~${Math.round(maxTokens * 0.6)}). Name them after what they contain, not "part2".
  3. Move code verbatim; don't rewrite it while splitting.
  4. Code: re-export from the original path (or its index file) so existing
     imports keep working, and update imports in the moved code.
     Tests: split by describe block into <name>.<topic>.spec.ts files and
     share fixtures via a helper file.
     Docs/markdown: split by heading into separate pages and link them from
     a short index at the original path.
  5. Run the tests/typecheck, then \`git add\` the new files and retry.

If the file is not agent-authored (generated, vendored, a lockfile), add its
pattern to IGNORED_PATTERNS in .githooks/check-file-size.mjs instead.
Bypass once with \`git commit --no-verify\`.
`;
}

function main() {
	const git = (...args) =>
		execFileSync('git', args, { maxBuffer: 256 * 1024 * 1024 });

	const files = git(
		'diff',
		'--cached',
		'--name-only',
		'--diff-filter=ACMR',
		'-z'
	)
		.toString()
		.split('\0')
		.filter(Boolean);

	const oversized = findOversized(files, (path) => git('show', `:${path}`));
	if (oversized.length > 0) {
		console.error(formatError(oversized));
		process.exit(1);
	}
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
