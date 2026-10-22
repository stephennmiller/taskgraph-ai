#!/usr/bin/env node
/**
 * Hold one of the two tasks.json locks while changing a task's status, so a
 * test can see whether the other lock scheme waits for it.
 *
 *   node --import tsx hold-lock.mjs <legacy|tm-core> <tasks.json> <task id> <status> <release file|none>
 *
 * Loads the code, prints "trying", takes the lock, prints "held", waits until the release file
 * exists (not at all for "none"), then sets the status and saves. The data is
 * read inside the lock before the wait, so a writer that got past the lock
 * during the wait loses its change when this one saves.
 *
 * "legacy" is withFileLockSync from scripts/modules/utils.js (a plain
 * tasks.json.lock file); "tm-core" is FileOperations.modifyJson (a
 * tasks.json.lock directory). Run through tsx because both pull in TypeScript.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const [mode, file, id, status, release] = process.argv.slice(2);
const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../../..');

const setStatus = (data) => {
	data.master.tasks.find((t) => String(t.id) === id).status = status;
	return data;
};

if (mode === 'legacy') {
	const { withFileLockSync } = await import(
		resolve(repoRoot, 'scripts/modules/utils.js')
	);
	console.log('trying');
	withFileLockSync(file, () => {
		const data = JSON.parse(readFileSync(file, 'utf8'));
		console.log('held');
		while (release !== 'none' && !existsSync(release)) {
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
		}
		writeFileSync(file, JSON.stringify(setStatus(data), null, 2));
	});
} else if (mode === 'tm-core') {
	const { FileOperations } = await import(
		resolve(
			repoRoot,
			'packages/tm-core/src/modules/storage/adapters/file-storage/file-operations.ts'
		)
	);
	console.log('trying');
	await new FileOperations().modifyJson(file, async (data) => {
		console.log('held');
		while (release !== 'none' && !existsSync(release)) await sleep(20);
		return setStatus(data);
	});
} else {
	console.error(`unknown mode ${mode}`);
	process.exit(2);
}
