import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('Rules Files Inclusion in Package', () => {
	// This test verifies that the required rules files are included in the final package

	test('package.json includes dist/** in the "files" array for bundled files', () => {
		// Read the package.json file
		const packageJsonPath = path.join(process.cwd(), 'package.json');
		const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

		// Check if dist/** is included in the files array (which contains bundled output including assets)
		expect(packageJson.files).toContain('dist/**');
	});
});
