/**
 * @fileoverview Per-user record of projects where `loop` may run Claude with
 * permission prompts off. It lives in the home directory, never in the
 * project, so a cloned repo cannot approve itself.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const trustFile = (home: string) =>
	path.join(home, '.taskgraph', 'loop-trusted.json');

function readTrusted(home: string): string[] {
	try {
		const list = JSON.parse(fs.readFileSync(trustFile(home), 'utf8'));
		return Array.isArray(list) ? list.filter((p) => typeof p === 'string') : [];
	} catch {
		return [];
	}
}

/** Symlinks and `..` must not make one path look like another */
function canonical(projectRoot: string): string {
	try {
		return fs.realpathSync(projectRoot);
	} catch {
		return path.resolve(projectRoot);
	}
}

export function isLoopTrusted(
	projectRoot: string,
	home: string = os.homedir()
): boolean {
	return readTrusted(home).includes(canonical(projectRoot));
}

export function trustLoop(
	projectRoot: string,
	home: string = os.homedir()
): void {
	const root = canonical(projectRoot);
	const trusted = readTrusted(home);
	if (trusted.includes(root)) return;
	fs.mkdirSync(path.dirname(trustFile(home)), { recursive: true });
	// Write beside, then rename, so a crash cannot leave half a file
	const tmp = `${trustFile(home)}.${process.pid}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify([...trusted, root], null, 2));
	fs.renameSync(tmp, trustFile(home));
}
