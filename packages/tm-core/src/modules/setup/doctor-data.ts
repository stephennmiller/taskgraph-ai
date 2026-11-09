/**
 * @fileoverview `taskgraph doctor`'s checks of the project's own files
 * (#1120): that config.json, config.local.json, state.json, tasks.json and
 * archive.json parse, and that every tag's tasks hold what the rest of
 * TaskGraph relies on. `--fix` repairs what has one safe answer, through the
 * same locked write every command uses.
 *
 * Each check is another module's rule, read-only: findStoredTaskProblems
 * (what the write funnel refuses), validateTaskDependencies (what
 * `fix-dependencies --check` reports) and withParentStatus (how the funnel
 * settles a parent). The repair runs fixTaskDependencies and
 * withParentStatus, so doctor never decides anything those don't.
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
import { readDefinitionOfDone } from '../config/services/config-file.js';
import {
	type DependencyFix,
	fixTaskDependencies,
	validateTaskDependencies
} from '../dependencies/dependency-check.js';
import { FileStorage } from '../storage/adapters/file-storage/file-storage.js';
import { FormatHandler } from '../storage/adapters/file-storage/format-handler.js';
import { archivePathFor, archivedTaskIds } from '../tasks/utils/archive.js';
import {
	type ParentDoneGuard,
	parentDoneGate,
	withParentStatus
} from '../tasks/utils/parent-status.js';
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
		| 'parent-status'
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
	// What the write path starts a new file from
	if (text.trim() === '') return null;
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

/** The parents whose status isn't the one their subtasks give them */
function unsettledParents(
	tasks: Task[],
	guardDone: ParentDoneGuard
): Array<{ index: number; settled: Task }> {
	return tasks.flatMap((task, index) => {
		const settled = withParentStatus(task, guardDone);
		return settled === task ? [] : [{ index, settled }];
	});
}

function tagFindings(
	tag: string,
	tasks: Task[],
	archive: unknown,
	guardDone: ParentDoneGuard
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
			// No command: readers refuse the whole tag until the value is fixed
			fix: `Edit ${TASKS_FILE}. ${STORED_TASK_FIXES[problem.kind]}`
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
		for (const { index, settled } of unsettledParents(tasks, guardDone)) {
			const task = tasks[index];
			findings.push({
				kind: 'parent-status',
				file: TASKS_FILE,
				tag,
				taskId: String(task.id),
				message: `Task ${task.id} is ${task.status}, but its subtasks make it ${settled.status}`,
				fixable: true
			});
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
	const guardDone = parentDoneGate(readDefinitionOfDone(root));
	const format = new FormatHandler();
	const tags = Object.keys(data).length > 0 ? format.extractTags(data) : [];
	const findings: DoctorFinding[] = [];
	let taskCount = 0;
	for (const tag of tags) {
		const tasks = format.extractTasksUnchecked(data, tag);
		taskCount += tasks.length;
		findings.push(...tagFindings(tag, tasks, archive, guardDone));
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
 * `fix-dependencies` does, then each parent whose status disagrees with its
 * subtasks. The caller has checked that every data file parses.
 * @returns What changed; empty when nothing needed repair
 * @throws What the write funnel throws, with the file untouched
 */
export async function repairTasks(root: string): Promise<DoctorRepair[]> {
	const definitionOfDone = () => readDefinitionOfDone(root);
	const guardDone = parentDoneGate(definitionOfDone());
	const storage = new FileStorage(root, definitionOfDone);
	return storage.mutateTags(async (tags) => {
		const repairs: DoctorRepair[] = [];
		const changed: string[] = [];
		for (const [tag, tasks] of tags) {
			const before = repairs.length;
			const archived = await storage.loadArchivedTaskIds(tag);
			for (const fix of fixTaskDependencies(tasks, archived).fixes) {
				repairs.push(dependencyRepair(tag, fix));
			}
			for (const { index, settled } of unsettledParents(tasks, guardDone)) {
				repairs.push({
					tag,
					taskId: String(settled.id),
					message: `Task ${settled.id} is now ${settled.status} (was ${tasks[index].status})`
				});
				tasks[index] = settled;
			}
			if (repairs.length > before) changed.push(tag);
		}
		return { changed, result: repairs };
	});
}
