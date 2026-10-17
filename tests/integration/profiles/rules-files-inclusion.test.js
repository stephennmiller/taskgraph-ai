import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { jest } from '@jest/globals';

describe('Rules Files Inclusion in Package', () => {
	// This test verifies that the required rules files are included in the final package

	test('package.json includes dist/** in the "files" array for bundled files', () => {
		// Read the package.json file
		const packageJsonPath = path.join(process.cwd(), 'package.json');
		const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

		// Check if dist/** is included in the files array (which contains bundled output including assets)
		expect(packageJson.files).toContain('dist/**');
	});

	test('source rules files exist in assets/rules directory', () => {
		// Verify that the actual rules files exist
		const rulesDir = path.join(process.cwd(), 'assets', 'rules');
		expect(fs.existsSync(rulesDir)).toBe(true);

		// Check for the 4 files that currently exist
		const expectedFiles = [
			'dev_workflow.mdc',
			'taskmaster.mdc',
			'self_improve.mdc',
			'cursor_rules.mdc'
		];

		expectedFiles.forEach((file) => {
			const filePath = path.join(rulesDir, file);
			expect(fs.existsSync(filePath)).toBe(true);
		});
	});
});
