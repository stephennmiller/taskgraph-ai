/**
 * @fileoverview The CLI commands and long flags a checkout declares, read
 * from its source, and the `taskgraph <cmd> --flag` calls in plugin text.
 *
 * Run it to write the snapshot the plugin's CLI range is checked against
 * (Node 22.18+ runs the .ts directly):
 *   node packages/tm-profiles/tests/integration/cli-surface.ts v0.58.1
 * The argument is a git ref (the tag of the range's minimum); it reads the
 * sources at that ref, so it needs the tag locally (`git fetch --tags`).
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Commands and their long flags, without the leading `--` */
export type CliSurface = Map<string, Set<string>>;

const stripComments = (source: string) =>
	source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// The long flags declared with .option('-x, --name <value>', ...),
// .requiredOption(...) or .addOption(new Option(...)), plus --json from
// the CLI's shared .addOption(jsonOption())
const longFlags = (source: string): string[] => [
	...[
		...source.matchAll(
			/(?:\.option|\.requiredOption|new Option)\(\s*(['"`])(.*?)\1/g
		)
	].flatMap((match) =>
		[...match[2].matchAll(/--([a-z][a-z-]*)/g)].map((flag) => flag[1])
	),
	...[...source.matchAll(/\.addOption\(\s*jsonOption\(\)\s*\)/g)].map(
		() => 'json'
	)
];

/** The surface of the CLI whose repo-relative files `read` returns */
export function cliSurface(read: (file: string) => string): CliSurface {
	const legacySource = stripComments(read('scripts/modules/commands.js'));
	const registrySource = stripComments(
		read('apps/cli/src/command-registry.ts')
	);
	const surface: CliSurface = new Map();

	// Legacy commands: the options between one .command('name') and the next
	const legacyStarts = [...legacySource.matchAll(/\.command\('([a-z-]+)'/g)];
	legacyStarts.forEach((match, index) => {
		const block = legacySource.slice(
			match.index,
			legacyStarts[index + 1]?.index ?? legacySource.length
		);
		surface.set(match[1], new Set(longFlags(block)));
	});

	// Registry commands: the options in the class file each entry points at
	for (const match of registrySource.matchAll(/^\s+name: '([a-z-]+)'/gm)) {
		surface.set(match[1], new Set());
	}
	// One import may name several classes from the same file
	const classFiles = new Map(
		[
			...registrySource.matchAll(
				/import \{([^}]+)\} from '\.\/(commands\/[^']+)\.js'/g
			)
		].flatMap((match) =>
			match[1]
				.split(',')
				.map((name) => name.trim())
				.filter(Boolean)
				.map((name) => [name, `apps/cli/src/${match[2]}.ts`] as const)
		)
	);
	for (const match of registrySource.matchAll(
		/name: '([a-z-]+)',[\s\S]*?commandClass: (\w+)/g
	)) {
		const file = classFiles.get(match[2]);
		if (!file) continue;
		const source = stripComments(read(file));
		const flags = new Set(longFlags(source));
		// .alias('status') makes `taskgraph status` the same command
		for (const name of [
			match[1],
			...[...source.matchAll(/\.alias\('([a-z-]+)'\)/g)].map((m) => m[1])
		]) {
			surface.set(name, flags);
		}
	}

	return surface;
}

/**
 * The code in a command body: each line of a fenced block, and each inline
 * `code` span outside one. Bodies name the commands to run in both forms.
 */
export function codeLines(markdown: string): string[] {
	const lines: string[] = [];
	let inFence = false;
	for (const line of markdown.split('\n')) {
		if (line.trim().startsWith('```')) {
			inFence = !inFence;
			continue;
		}
		if (inFence) lines.push(line);
		else for (const span of line.matchAll(/`([^`]+)`/g)) lines.push(span[1]);
	}
	return lines;
}

/** A hook's shell one-liner as one line per command it runs */
export const hookLines = (command: string): string[] =>
	command.split(/;|&&|\|\||\||\$\(|\)/);

/** `taskgraph <name> ...` at the start of each line, with its long flags */
export function invocations(lines: string[]) {
	const calls: Array<{ command: string; flags: string[] }> = [];
	for (const line of lines) {
		const match = line.match(/^\s*(?:\$ )?taskgraph ([a-z][a-z-]*)(.*)$/);
		if (!match) continue;
		// Drop quoted text (a prompt can mention flags) and comments
		const args = match[2]
			.replace(/\\'/g, '')
			.replace(/'[^']*'|"[^"]*"/g, '""')
			.split('#')[0];
		calls.push({
			command: match[1],
			flags: [...args.matchAll(/(?:^|\s)--([a-z][a-z-]*)/g)].map(
				(flag) => flag[1]
			)
		});
	}
	return calls;
}

/** `<command> --<flag>` for each flag in `calls` its command lacks */
export const unknownFlags = (
	calls: ReturnType<typeof invocations>,
	surface: CliSurface
): string[] =>
	calls.flatMap(({ command, flags }) => {
		const known = surface.get(command);
		return flags
			.filter(
				(flag) =>
					flag !== 'help' &&
					!known?.has(flag) &&
					!known?.has(`no-${flag}`) &&
					!(flag.startsWith('no-') && known?.has(flag.slice(3)))
			)
			.map((flag) => `${command} --${flag}`);
	});

// Slash-command arguments written as flags, not passed to the CLI
const SLASH_ARGUMENTS = new Set(['quick', 'subtasks']);

/** A flag named on its own (`--research`) none of the body's commands has */
export function unknownStandaloneFlags(
	markdown: string,
	surface: CliSurface
): string[] {
	const known = new Set(
		invocations(codeLines(markdown)).flatMap(({ command }) => [
			...(surface.get(command) ?? [])
		])
	);
	return codeLines(markdown).flatMap((line) => {
		const flag = line.match(/^--([a-z][a-z-]*)/)?.[1];
		return flag && !known.has(flag) && !SLASH_ARGUMENTS.has(flag)
			? [`--${flag}`]
			: [];
	});
}

export const SNAPSHOT_FILE = join(
	dirname(fileURLToPath(import.meta.url)),
	'plugin-cli-surface.json'
);

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	const ref = process.argv[2];
	if (!ref) {
		console.error('Usage: node cli-surface.ts <git ref, e.g. v0.58.1>');
		process.exit(1);
	}
	const read = (file: string) =>
		execFileSync('git', ['show', `${ref}:${file}`], {
			encoding: 'utf-8',
			maxBuffer: 64 * 1024 * 1024
		});
	const surface = cliSurface(read);
	const commands = Object.fromEntries(
		[...surface.keys()]
			.sort()
			.map((name) => [name, [...surface.get(name)!].sort()])
	);
	const version = JSON.parse(read('package.json')).version;
	writeFileSync(
		SNAPSHOT_FILE,
		`${JSON.stringify({ version, commands }, null, '\t')}\n`
	);
	// Biome's style, so CI's format check passes on the written file
	execFileSync('npx', ['biome', 'format', '--write', SNAPSHOT_FILE]);
	console.log(
		`Wrote the taskgraph ${version} commands and flags to ${SNAPSHOT_FILE}`
	);
}
