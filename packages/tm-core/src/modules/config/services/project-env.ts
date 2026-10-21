/**
 * @fileoverview Per-project environment
 * A long-running server may serve several projects, so a project's .env is
 * read into a value that is handed on, never loaded into process.env.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { getLogger } from '../../../common/logger/index.js';

export type EnvMap = Record<string, string | undefined>;

/**
 * The project's .env with process.env on top, so values the host passed in
 * win over the file, as dotenv's default did.
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
	return { ...fromFile, ...process.env };
}
