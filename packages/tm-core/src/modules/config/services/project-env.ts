/**
 * @fileoverview Per-project environment
 * A long-running server may serve several projects, so a project's .env is
 * read into a value that is handed on, never loaded into process.env.
 *
 * `TASKGRAPH_NO_TASK_DATA_FENCE` is copied here, once, from the process
 * environment as this module loads. That is before `readProjectEnv` merges a
 * project file. Nothing in a project can change the copy afterward.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { getLogger } from '../../../common/logger/index.js';

export type EnvMap = Record<string, string | undefined>;

/** Shell opt-out for the `<task-data>` lines on human `list` and `show` (#929) */
export const NO_TASK_DATA_FENCE_ENV = 'TASKGRAPH_NO_TASK_DATA_FENCE';

/**
 * What a project's `.env` may contribute. `allow` is the only keys copied
 * out of the file. `shellOnly` is never copied, even if it is later added
 * to `allow`: only the process environment from before this merge counts.
 */
export const PROJECT_ENV_ALLOWLIST = {
	allow: [
		'TASKGRAPH_TAG',
		'TASKGRAPH_RESPONSE_LANGUAGE',
		'TASKGRAPH_MODEL_MAIN',
		'TASKGRAPH_MODEL_RESEARCH',
		'TASKGRAPH_MODEL_FALLBACK',
		'TASKGRAPH_ENABLE_CODEBASE_ANALYSIS'
	],
	shellOnly: [NO_TASK_DATA_FENCE_ENV]
} as const;

const FILE_KEYS = new Set<string>(PROJECT_ENV_ALLOWLIST.allow);
const SHELL_ONLY_KEYS = new Set<string>(PROJECT_ENV_ALLOWLIST.shellOnly);

/**
 * Process environment at load, before any project `.env` is read. Frozen so
 * a later write to this object cannot turn the fence opt-out on.
 */
const shellEnvAtLoad: EnvMap = Object.freeze({ ...process.env });

/** A name only the shell may set. A project `.env` value is ignored. */
export function isShellOnlyEnv(name: string): boolean {
	return SHELL_ONLY_KEYS.has(name);
}

/** The value `name` had in the process environment when this module loaded */
export function shellEnvBeforeProject(name: string): string | undefined {
	return shellEnvAtLoad[name];
}

/** True only for the exact shell value `1` */
export function isTaskDataFenceOptOut(value: string | undefined): boolean {
	return value === '1';
}

/**
 * Whether the shell turned `<task-data>` fences off, from the process
 * environment captured before project env loading. A project `.env` or
 * `config.json` cannot set this.
 */
export function shellDisablesTaskDataFence(): boolean {
	return isTaskDataFenceOptOut(shellEnvBeforeProject(NO_TASK_DATA_FENCE_ENV));
}

/** Drop shell-only keys at any depth so `config.json` cannot set them */
export function omitShellOnlyConfig<T>(value: T): T {
	if (Array.isArray(value)) {
		return value.map((entry) => omitShellOnlyConfig(entry)) as T;
	}
	if (typeof value !== 'object' || value === null) return value;
	const out: Record<string, unknown> = {};
	for (const key of Object.keys(value as object)) {
		if (
			key === '__proto__' ||
			key === 'constructor' ||
			key === 'prototype' ||
			isShellOnlyEnv(key)
		) {
			continue;
		}
		out[key] = omitShellOnlyConfig((value as Record<string, unknown>)[key]);
	}
	return out as T;
}

/** Keys from a project `.env` that the allowlist accepts */
function projectFileEnv(parsed: EnvMap): EnvMap {
	const out: EnvMap = {};
	for (const [key, value] of Object.entries(parsed)) {
		if (isShellOnlyEnv(key) || !FILE_KEYS.has(key)) continue;
		out[key] = value;
	}
	return out;
}

/**
 * The project's .env with process.env on top, so values the host passed in
 * win over the file, as dotenv's default did. The file contributes only
 * `PROJECT_ENV_ALLOWLIST.allow`. Shell-only keys are left out of the file
 * half even when the process environment did not set them.
 */
export function readProjectEnv(projectRoot: string): EnvMap {
	let fromFile: EnvMap = {};
	try {
		fromFile = parseEnv(
			fs.readFileSync(path.join(projectRoot, '.env'), 'utf-8')
		);
	} catch (error) {
		// No .env just means no project settings; anything else the user should see
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
			getLogger('project-env').warn(
				`Could not read ${path.join(projectRoot, '.env')}: ${(error as Error).message}`
			);
		}
	}
	return { ...projectFileEnv(fromFile), ...process.env };
}
