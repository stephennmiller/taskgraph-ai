/**
 * @fileoverview What a short flag meant on a command before each letter got
 * one meaning (`-p` in #882, the rest in #1155), so an old spelling fails
 * with a hint that names the long form:
 *
 *   ✗ Unknown option '-f'
 *     -f means --format; write --force in full
 */

/** What each letter means now, as the hint says it */
const MEANS: Record<string, string> = {
	a: '--all',
	c: '--compact',
	d: '--description',
	f: '--format',
	i: '--id',
	n: 'a count',
	p: '--project',
	r: '--research',
	s: '--status',
	t: '--tag',
	v: '--verbose'
};

const LEGACY_FILE =
	'add-subtask add-tag add-task analyze-complexity clear-subtasks copy-tag ' +
	'delete-tag move remove-subtask remove-task rename-tag scope scope-down ' +
	'scope-up sync-readme update update-subtask update-task use-tag';

/** Letter, the long option it was, and the commands where it was that */
export const OLD_SHORT_FLAGS: readonly [string, string, string][] = [
	['a', '--author', 'init'],
	['c', '--context', 'research'],
	['c', '--convert', 'remove-task remove-subtask'],
	['d', '--depends-on', 'depend add-dependency remove-dependency'],
	['d', '--detail', 'research'],
	['f', '--file', `note complexity-report ${LEGACY_FILE}`],
	['f', '--files', 'research'],
	['f', '--force', 'expand parse-prd'],
	['i', '--input', 'parse-prd'],
	['i', '--task-id', 'add-subtask'],
	['n', '--name', 'init'],
	['p', '--parent', 'add-subtask'],
	[
		'p',
		'--prompt',
		'loop add-task expand update update-task update-subtask scope scope-up scope-down'
	],
	['r', '--rules', 'init'],
	['s', '--save', 'research'],
	['s', '--strength', 'scope scope-up scope-down'],
	['t', '--threshold', 'analyze-complexity'],
	['t', '--title', 'add-task add-subtask'],
	['t', '--tree', 'research'],
	['v', '--version', 'init']
];

/**
 * The hint for a short flag that used to mean something else on this command
 * @param command - The top-level command name
 * @param letter - The short flag, without its dash
 */
export function oldShortFlagHint(
	command: string,
	letter: string
): string | undefined {
	const was = OLD_SHORT_FLAGS.find(
		([l, , commands]) => l === letter && commands.split(' ').includes(command)
	)?.[1];
	return was && `-${letter} means ${MEANS[letter]}; write ${was} in full`;
}

/**
 * The hint for `research 'q' -t --save out.md`: `-t` took no value when it
 * was `--tree`, so as `--tag` it swallows the next flag and Commander stops
 * on the argument left over
 */
export function swallowedFlagHint(
	command: string,
	argv: readonly string[] = process.argv
): string | undefined {
	for (const [i, arg] of argv.entries()) {
		if (!/^-[A-Za-z]$/.test(arg) || !argv[i + 1]?.startsWith('-')) continue;
		const hint = oldShortFlagHint(command, arg[1]);
		if (hint) return hint;
	}
	return undefined;
}

/**
 * The short flags that take no value, which can sit before another letter
 * in one word (`-rt x`). old-short-flags.spec.ts checks it against the
 * program.
 */
export const VALUELESS_SHORT_FLAGS = 'acrvwyh';

/**
 * The same hint, only when the short form was typed (`-t x`, `-tx`, or
 * `-rt x`) rather than the long one; Commander doesn't say which spelling it
 * read. `-dtest` is `--description test`, not a typed `-t`.
 */
export function typedOldShortFlagHint(
	command: string,
	letter: string,
	argv: readonly string[] = process.argv
): string | undefined {
	const typed = new RegExp(`^-[${VALUELESS_SHORT_FLAGS}]*${letter}`);
	return argv.some((arg) => typed.test(arg))
		? oldShortFlagHint(command, letter)
		: undefined;
}
