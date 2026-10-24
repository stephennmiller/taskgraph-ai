import { randomBytes } from 'node:crypto';
import fs from 'node:fs';

/**
 * Write next to `file`, then rename over it, so `file` is either the old
 * content or the whole new one. `wx` refuses a temp name that already exists
 * (including a symlink planted there) instead of writing through it; the
 * random part keeps a killed run's leftover from blocking later runs.
 */
export function writeAtomically(file: string, content: string): void {
	const temp = `${file}.taskgraph-${process.pid}-${randomBytes(6).toString('hex')}.tmp`;
	try {
		fs.writeFileSync(temp, content, { encoding: 'utf8', flag: 'wx' });
		fs.renameSync(temp, file);
	} catch (error) {
		// EEXIST: the temp name holds something we didn't write; leave it be
		if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
			fs.rmSync(temp, { force: true });
		}
		throw error;
	}
}
