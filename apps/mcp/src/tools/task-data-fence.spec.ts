/**
 * The shell opt-out for `<task-data>` fences is human CLI output only.
 * No MCP tool reads it (#929).
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const OPT_OUT = 'TASKGRAPH_NO_TASK_DATA_FENCE';

function sourceFiles(dir: string): string[] {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) return sourceFiles(full);
		if (!entry.name.endsWith('.ts') || entry.name.endsWith('.spec.ts')) {
			return [];
		}
		return [full];
	});
}

describe('MCP task-data fences', () => {
	it('no MCP source reads the shell fence opt-out (#929)', () => {
		const root = path.resolve(import.meta.dirname, '..');
		const hits = sourceFiles(root).filter((file) =>
			fs.readFileSync(file, 'utf8').includes(OPT_OUT)
		);

		expect(hits).toEqual([]);
	});
});
