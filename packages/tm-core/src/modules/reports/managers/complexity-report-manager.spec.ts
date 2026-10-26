import { describe, expect, it } from 'vitest';
import { complexityReportPath } from './complexity-report-manager.js';

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
