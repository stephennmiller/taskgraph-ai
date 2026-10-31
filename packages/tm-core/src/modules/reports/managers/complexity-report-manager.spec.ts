import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	ComplexityReportManager,
	complexityReportPath
} from './complexity-report-manager.js';

describe('complexityReportPath', () => {
	it('puts a tag in the report name', () => {
		expect(complexityReportPath('/p', 'feature-x')).toBe(
			'/p/.taskgraph/reports/task-complexity-report_feature-x.json'
		);
	});

	it('refuses a tag that is not a tag name', () => {
		expect(() => complexityReportPath('/p', 'x/../../../escaped')).toThrow(
			"isn't a valid tag name"
		);
	});
});

describe('ComplexityReportManager', () => {
	it('finds no report for a tag that is not a tag name, instead of throwing', async () => {
		const manager = new ComplexityReportManager('/p');

		await expect(manager.loadReport('evil\u001b[31m')).resolves.toBeNull();
		await expect(manager.hasReport('x/../../../escaped')).resolves.toBe(false);
	});

	it('reloads a report another process rewrote since it was cached', async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-complexity-'));
		const file = complexityReportPath(root);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		const write = (score: number) =>
			fs.writeFileSync(
				file,
				JSON.stringify({
					meta: {},
					complexityAnalysis: [{ taskId: 1, complexityScore: score }]
				})
			);
		const manager = new ComplexityReportManager(root);
		try {
			write(2);
			expect((await manager.getComplexityForTask('1'))?.complexityScore).toBe(
				2
			);

			write(9); // Same size; a later mtime, as a real rewrite has
			const later = new Date(Date.now() + 5000);
			fs.utimesSync(file, later, later);

			expect((await manager.getComplexityForTask('1'))?.complexityScore).toBe(
				9
			);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});
