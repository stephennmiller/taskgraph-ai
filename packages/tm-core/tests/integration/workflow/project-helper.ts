import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * A throwaway git project plus a throwaway HOME, so workflow state never
 * lands in the real ~/.taskgraph. Call restore() when done.
 */
export function createWorkflowProject() {
	const originalHome = process.env.HOME;
	const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-wf-home-'));
	const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-wf-project-'));
	process.env.HOME = homeDir;

	const git = (cmd: string) =>
		execSync(cmd, { cwd: projectDir, stdio: 'pipe' });
	git('git init');
	git('git config user.email "test@test.com"');
	git('git config user.name "Test User"');
	git('git config commit.gpgsign false');
	fs.writeFileSync(path.join(projectDir, 'README.md'), '# Test\n');
	git('git add .');
	git('git commit -m "Initial commit"');

	return {
		projectDir,
		restore() {
			process.env.HOME = originalHome;
			fs.rmSync(projectDir, { recursive: true, force: true });
			fs.rmSync(homeDir, { recursive: true, force: true });
		}
	};
}
