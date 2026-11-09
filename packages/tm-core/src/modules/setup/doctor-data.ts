/**
 * @fileoverview `taskgraph doctor`'s checks of the project's own files
 * (#1120): that config.json, config.local.json, state.json, tasks.json and
 * archive.json parse, and that every tag's tasks hold what the rest of
 * TaskGraph relies on. `--fix` repairs what has one safe answer, through the
 * same locked write every command uses.
 *
 * Each check is another module's rule, read-only: findStoredTaskProblems
 * (what the write funnel refuses) and validateTaskDependencies (what
 * `fix-dependencies --check` reports). The repair runs fixTaskDependencies,
 * so doctor never decides anything that doesn't.
 *
 * A parent's status against its subtasks isn't checked: state machine 2
 * forbids no such state at rest. `set-status` on a parent may leave it done
 * over open subtasks, or pending over finished ones, and the write funnel
 * keeps that (settleChangedParents settles only a parent whose subtasks a
 * write changed), so the file can't tell a deliberate status from a stale one.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
	TASKGRAPH_CONFIG_FILE,
	TASKGRAPH_LOCAL_CONFIG_FILE,
	TASKGRAPH_STATE_FILE,
	TASKGRAPH_TASKS_FILE
} from '../../common/constants/paths.js';
import type { Task } from '../../common/types/index.js';
import {
	type DependencyFix,
	fixTaskDependencies,
	validateTaskDependencies
} from '../dependencies/dependency-check.js';
import { FileStorage } from '../storage/adapters/file-storage/file-storage.js';
import { FormatHandler } from '../storage/adapters/file-storage/format-handler.js';
import { archivePathFor, archivedTaskIds } from '../tasks/utils/archive.js';
import {
	STORED_TASK_FIXES,
	type StoredTaskProblemKind,
	findStoredTaskProblems
} from '../tasks/validation/stored-tasks.js';

/** One thing wrong in a data file */
export interface DoctorFinding {
	kind:
		| 'unreadable-file'
		| StoredTaskProblemKind
		| 'dependency'
		/** A tag too broken to check past the problems listed before it */
		| 'unchecked';
	/** The file, relative to the project root, with `/` */
	file: string;
	/** For a file that doesn't parse: the line, when it can be told */
	line?: number;
	tag?: string;
	/** The task ("3") or subtask ("3.2") */
	taskId?: string;
	/** What is wrong, in plain words */
	message: string;
	/** `doctor --fix` repairs it */
	fixable: boolean;
	/** For the rest: how to fix it, with any command in backticks */
	fix?: string;
}

/** One change `doctor --fix` made to tasks.json */
export interface DoctorRepair {
	tag: string;
	taskId: string;
	message: string;
}

export interface DataFilesReport {
	/** The data files that exist and parse */
	read: number;
	/** One per file that doesn't parse */
	unreadable: DoctorFinding[];
	/** Null when tasks.json is missing or doesn't parse */
	tasks: {
		taskCount: number;
		tagCount: number;
		findings: DoctorFinding[];
	} | null;
}

const TASKS_FILE = TASKGRAPH_TASKS_FILE;
const ARCHIVE_FILE = archivePathFor(TASKGRAPH_TASKS_FILE).replace(/\\/g, '/');
const DATA_FILES = [
	TASKGRAPH_CONFIG_FILE,
	TASKGRAPH_LOCAL_CONFIG_FILE,
	TASKGRAPH_STATE_FILE,
	TASKS_FILE,
	ARCHIVE_FILE
];

const CONFLICT_MARKER = /^(<{7}|={7}|>{7})(\s|$)/m;

/**
 * Where a file stops being JSON, as far as it can be told: a git conflict
 * marker first, since JSON.parse gives no position for a stray `<`
 */
function badLine(text: string, error: Error): number | undefined {
	const marker = CONFLICT_MARKER.exec(text);
	if (marker) return text.slice(0, marker.index).split('\n').length;
	const at = /\(line (\d+) column \d+\)/.exec(error.message);
	if (at) return Number(at[1]);
	// Cut off: the last line with anything on it
	if (/end of JSON input/.test(error.message)) {
		return Math.max(1, text.trimEnd().split('\n').length);
	}
	return undefined;
}

/** Parse one data file: its JSON object, null when missing, or the finding */
function readDataFile(
	root: string,
	file: string
): Record<string, unknown> | null | DoctorFinding {
	const unreadable = (message: string, line?: number): DoctorFinding => ({
		kind: 'unreadable-file',
		file,
		...(line !== undefined && { line }),
		message,
		fixable: false,
		fix: 'Fix the JSON by hand, then run `taskgraph doctor` again'
	});
	let text: string;
	try {
		text = fs.readFileSync(path.join(root, file), 'utf8');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
		return unreadable(`${file} can't be read`);
	}
	// Every reader takes an empty config.local.json as no settings, and
	// refuses the other four when empty
	if (text.trim() === '') {
		return file === TASKGRAPH_LOCAL_CONFIG_FILE
			? null
			: unreadable(`${file} is empty`);
	}
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch (error) {
		const line = badLine(text, error as Error);
		const conflict = CONFLICT_MARKER.test(text);
		return {
			...unreadable(
				conflict
					? `${file} has a git conflict marker${line ? ` on line ${line}` : ''}`
					: `${file} isn't valid JSON${line ? ` (line ${line})` : ''}`,
				line
			),
			...(conflict && {
				fix: 'Resolve the conflict in the file, then run `taskgraph doctor` again'
			})
		};
	}
	if (typeof data !== 'object' || data === null || Array.isArray(data)) {
		return unreadable(`${file} doesn't hold a JSON object`);
	}
	return data as Record<string, unknown>;
}

const isFinding = (value: unknown): value is DoctorFinding =>
	typeof value === 'object' && value !== null && 'fixable' in value;

function tagFindings(
	tag: string,
	tasks: Task[],
	archive: unknown
): DoctorFinding[] {
	const tagOption = ` --tag=${tag}`;
	const findings: DoctorFinding[] = findStoredTaskProblems(tasks).map(
		(problem) => ({
			kind: problem.kind,
			file: TASKS_FILE,
			tag,
			taskId: problem.taskId,
			message: problem.message,
			fixable: false,
			// Readers refuse the whole tag over a task's status or priority. Only
			// set-status reaches one, as stored, and not to done: its gate reads
			fix:
				problem.kind === 'unknown-status' && !problem.taskId.includes('#')
					? `Run \`taskgraph set-status --id=${problem.taskId} --status=pending${tagOption}\`, then set the status it should have`
					: `Edit ${TASKS_FILE}. ${STORED_TASK_FIXES[problem.kind]}`
		})
	);
	// An ID that isn't a number is never printed, and no command can load the
	// tag until it is fixed: the checks below would name tasks by it
	if (findings.some((finding) => finding.taskId?.includes('#')))
		return findings;
	try {
		// Without a readable archive, a dependency on an archived task would look missing
		if (archive !== undefined) {
			const { issues } = validateTaskDependencies(
				tasks,
				archivedTaskIds(archive, tag)
			);
			for (const issue of issues) {
				const fixable = issue.type !== 'circular' || issue.fixable === true;
				findings.push({
					kind: 'dependency',
					file: TASKS_FILE,
					tag,
					taskId: String(issue.taskId),
					message: issue.message,
					fixable,
					...(!fixable && {
						fix: `Break the loop: \`taskgraph depend --id=${issue.taskId} --depends-on=<id> --remove${tagOption}\``
					})
				});
			}
		}
	} catch {
		// A field of the wrong type; say so only if nothing above already did
		if (findings.length === 0) {
			findings.push({
				kind: 'unchecked',
				file: TASKS_FILE,
				tag,
				message: `Tag '${tag}' holds a task that can't be checked`,
				fixable: false,
				fix: `Edit ${TASKS_FILE}`
			});
		}
	}
	return findings;
}

/**
 * Parse the project's five data files and check every tag of tasks.json,
 * changing nothing. A missing file is fine: each is created when first
 * needed.
 */
export function checkDataFiles(root: string): DataFilesReport {
	const files = new Map(DATA_FILES.map((f) => [f, readDataFile(root, f)]));
	const unreadable = [...files.values()].filter(isFinding);
	const read = [...files.values()].filter((f) => f && !isFinding(f)).length;

	const data = files.get(TASKS_FILE);
	if (!data || isFinding(data)) return { read, unreadable, tasks: null };

	const archiveFile = files.get(ARCHIVE_FILE);
	const archive = isFinding(archiveFile) ? undefined : (archiveFile ?? {});
	const format = new FormatHandler();
	const tags = Object.keys(data).length > 0 ? format.extractTags(data) : [];
	const findings: DoctorFinding[] = [];
	let taskCount = 0;
	for (const tag of tags) {
		const tasks = format.extractTasksUnchecked(data, tag);
		if (!tasks) {
			findings.push({
				kind: 'unchecked',
				file: TASKS_FILE,
				tag,
				message: `Tag '${tag}' holds tasks that aren't a list`,
				fixable: false,
				fix: `Edit ${TASKS_FILE}`
			});
			continue;
		}
		taskCount += tasks.length;
		findings.push(...tagFindings(tag, tasks, archive));
	}
	return {
		read,
		unreadable,
		tasks: { taskCount, tagCount: tags.length, findings }
	};
}

function dependencyRepair(tag: string, fix: DependencyFix): DoctorRepair {
	const id = String(fix.taskId);
	const noun = id.includes('.') ? 'Subtask' : 'Task';
	const what: Record<DependencyFix['type'], string> = {
		missing: `no longer depends on ${fix.dependencyId}, which doesn't exist`,
		self: 'no longer depends on itself',
		duplicate: `lists its dependency on ${fix.dependencyId} once`,
		circular: `no longer depends on ${fix.dependencyId}, which depended on it`,
		'missing-link': `no longer links to ${fix.dependencyId}, which doesn't exist`,
		rewritten: `depends on ${fix.dependencyId}, stored before as ${JSON.stringify(fix.storedAs)}`
	};
	return { tag, taskId: id, message: `${noun} ${id} ${what[fix.type]}` };
}

/**
 * Repair every tag of tasks.json in one locked write: dependencies as
 * `fix-dependencies` does. The caller has checked that every data file parses.
 * @returns What changed; empty when nothing needed repair
 * @throws What the write funnel throws, with the file untouched
 */
export async function repairTasks(root: string): Promise<DoctorRepair[]> {
	const storage = new FileStorage(root);
	return storage.mutateTags(async (tags) => {
		const repairs: DoctorRepair[] = [];
		const changed: string[] = [];
		for (const [tag, tasks] of tags) {
			const before = repairs.length;
			const archived = await storage.loadArchivedTaskIds(tag);
			for (const fix of fixTaskDependencies(tasks, archived).fixes) {
				repairs.push(dependencyRepair(tag, fix));
			}
			if (repairs.length > before) changed.push(tag);
		}
		return { changed, result: repairs };
	});
}
