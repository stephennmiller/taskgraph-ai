/**
 * @fileoverview Describe a Commander program as plain data for shell completion.
 * The shell scripts are generated from this, so they always match the
 * commands and flags of the installed version.
 */

import type { Argument, Command, Option } from 'commander';

/**
 * What a value can be completed with.
 * - ids: task and subtask IDs from the project's tasks.json
 * - tags: tag names from the project's tasks.json
 * - files / dirs: the shell's own path completion
 * - choices: a fixed list (see `choices`)
 * - none: free text, nothing to suggest
 */
export type ValueKind = 'ids' | 'tags' | 'files' | 'dirs' | 'choices' | 'none';

export interface ValueSpec {
	kind: ValueKind;
	choices?: string[];
}

export interface OptionSpec {
	short?: string;
	long?: string;
	description: string;
	/** Undefined when the flag takes no value */
	value?: ValueSpec;
	/** The value may be left out (`--flag [value]`) */
	optional?: boolean;
	/** The flag takes several values (`--flag <values...>`) */
	variadic?: boolean;
}

export interface ArgumentSpec {
	name: string;
	variadic: boolean;
	value: ValueSpec;
}

export interface CommandSpec {
	name: string;
	aliases: string[];
	description: string;
	options: OptionSpec[];
	args: ArgumentSpec[];
	commands: CommandSpec[];
}

export const STATUS_CHOICES = [
	'pending',
	'in-progress',
	'done',
	'review',
	'blocked',
	'deferred',
	'cancelled'
];
export const PRIORITY_CHOICES = ['high', 'medium', 'low'];

const ID_NAMES = new Set(['id', 'ids', 'taskid', 'task-id', 'parent']);
const TAG_NAMES = new Set([
	'tag',
	'tagname',
	'oldname',
	'sourcename',
	'source',
	'name'
]);
const TAG_OPTIONS = new Set(['--tag', '--from-tag', '--to-tag', '--copy-from']);
const ID_OPTIONS = new Set(['--from', '--to', '--save-to']);
const FILE_NAMES = new Set(['file', 'files', 'paths']);
const DIR_NAMES = new Set(['dir', 'path']);
/** Commands whose name argument is a new tag, so existing tags are wrong */
const CREATES_TAG = new Set(['add', 'add-tag']);

/** Name inside <...> or [...], e.g. "--id <ids>" → "ids" */
function metavar(flags: string): string | undefined {
	const m = flags.match(/[<[]([^>\]]+?)(?:\.\.\.)?[>\]]/);
	return m ? m[1].toLowerCase() : undefined;
}

function inferValue(
	name: string | undefined,
	choices: readonly string[] | undefined,
	context: { long?: string; command: string }
): ValueSpec {
	if (choices?.length) return { kind: 'choices', choices: [...choices] };
	const long = context.long;
	if (long === '--status' || name === 'status') {
		return { kind: 'choices', choices: STATUS_CHOICES };
	}
	if (long === '--priority' || name === 'priority') {
		return { kind: 'choices', choices: PRIORITY_CHOICES };
	}
	if (long === '--format' || name === 'format') {
		return { kind: 'choices', choices: ['text', 'json'] };
	}
	if (long && TAG_OPTIONS.has(long)) return { kind: 'tags' };
	if (long && ID_OPTIONS.has(long)) return { kind: 'ids' };
	if (
		long === '--project' ||
		long === '--project-root' ||
		long === '--output'
	) {
		return { kind: long === '--output' ? 'files' : 'dirs' };
	}
	if (!name) return { kind: 'none' };
	if (ID_NAMES.has(name)) return { kind: 'ids' };
	if (TAG_NAMES.has(name)) {
		return CREATES_TAG.has(context.command)
			? { kind: 'none' }
			: { kind: 'tags' };
	}
	if (FILE_NAMES.has(name)) return { kind: 'files' };
	if (DIR_NAMES.has(name)) return { kind: 'dirs' };
	return { kind: 'none' };
}

function optionSpec(opt: Option, command: string): OptionSpec {
	const takesValue = opt.required || opt.optional;
	return {
		short: opt.short,
		long: opt.long,
		description: firstLine(opt.description),
		value: takesValue
			? inferValue(metavar(opt.flags), opt.argChoices, {
					long: opt.long,
					command
				})
			: undefined,
		...(opt.optional ? { optional: true } : {}),
		...(opt.variadic ? { variadic: true } : {})
	};
}

function argumentSpec(arg: Argument, command: string): ArgumentSpec {
	return {
		name: arg.name(),
		variadic: arg.variadic,
		value: inferValue(arg.name().toLowerCase(), arg.argChoices, { command })
	};
}

function firstLine(text: string | undefined): string {
	return (text || '').split('\n')[0].trim();
}

function isHidden(cmd: Command): boolean {
	return Boolean((cmd as unknown as { _hidden?: boolean })._hidden);
}

/**
 * Build the completion spec for a Commander program.
 * Hidden commands and options are left out.
 */
export function buildCompletionSpec(program: Command): CommandSpec {
	const walk = (cmd: Command): CommandSpec => {
		const name = cmd.name();
		const options = cmd.options
			.filter((o) => !o.hidden)
			.map((o) => optionSpec(o, name));
		if (!options.some((o) => o.long === '--help')) {
			options.push({ short: '-h', long: '--help', description: 'Show help' });
		}
		return {
			name,
			aliases: cmd.aliases(),
			description: firstLine(cmd.description()),
			options,
			args: cmd.registeredArguments.map((a) => argumentSpec(a, name)),
			commands: cmd.commands.filter((c) => !isHidden(c)).map(walk)
		};
	};
	return walk(program);
}
