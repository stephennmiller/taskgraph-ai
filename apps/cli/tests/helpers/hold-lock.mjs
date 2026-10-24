#!/usr/bin/env node
/**
 * Change a task's status through tm-core's tasks.json lock
 * (FileOperations.modifyJson, a tasks.json.lock directory), so a test can see
 * whether it waits for another lock holder.
 *
 *   node --import tsx hold-lock.mjs <tasks.json> <task id> <status>
 *
 * Prints "trying" once the code is loaded, before it takes the lock. Run
 * through tsx because it pulls in TypeScript.
 */

import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [file, id, status] = process.argv.slice(2);
const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../../..');
// import() takes a URL; a Windows path (D:\...) reads as a "d:" scheme
const { FileOperations } = await import(
	pathToFileURL(
		resolve(
			repoRoot,
			'packages/tm-core/src/modules/storage/adapters/file-storage/file-operations.ts'
		)
	).href
);

console.log('trying');
await new FileOperations().modifyJson(file, async (data) => {
	data.master.tasks.find((t) => String(t.id) === id).status = status;
	return data;
});
