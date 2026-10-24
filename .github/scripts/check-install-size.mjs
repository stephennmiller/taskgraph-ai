#!/usr/bin/env node
import { lstatSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The Claude Agent SDK installs a ~230 MB Claude Code binary for the platform
// as an optional dependency (@anthropic-ai/claude-agent-sdk-linux-x64 and so
// on). It stays: the SDK runs that exact build. The budget covers everything
// else, so a new heavy dependency fails CI instead of growing every install.
const DEFAULT_BUDGET_MB = 150;

/** Whether a directory is one of the Agent SDK's platform binary packages */
export function isAgentSdkBinary(dir) {
	return (
		basename(dirname(dir)) === '@anthropic-ai' &&
		basename(dir).startsWith('claude-agent-sdk-')
	);
}

/**
 * Bytes of the files under a node_modules directory, by file size (not disk
 * blocks, which vary by filesystem). Symlinks are not followed and a
 * hard-linked file counts once.
 * @returns {{ totalBytes: number, agentSdkBinaryBytes: number }}
 */
export function measureInstall(nodeModulesDir) {
	let totalBytes = 0;
	let agentSdkBinaryBytes = 0;
	const seen = new Set();

	const walk = (dir, inBinary) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(path, inBinary || isAgentSdkBinary(path));
			} else if (entry.isFile()) {
				const { size, dev, ino } = lstatSync(path);
				const id = `${dev}:${ino}`;
				if (seen.has(id)) continue;
				seen.add(id);
				totalBytes += size;
				if (inBinary) agentSdkBinaryBytes += size;
			}
		}
	};
	walk(nodeModulesDir, false);

	return { totalBytes, agentSdkBinaryBytes };
}

const toMB = (bytes) => bytes / 1024 / 1024;

// Run by .github/scripts/pack-smoke.sh after installing the packed tarball.
// Usage: node check-install-size.mjs <node_modules> [budgetMB]
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const [dir = 'node_modules', budgetArg] = process.argv.slice(2);
	const budgetMB = Number(budgetArg ?? DEFAULT_BUDGET_MB);
	const { totalBytes, agentSdkBinaryBytes } = measureInstall(dir);
	const counted = toMB(totalBytes - agentSdkBinaryBytes);

	console.log(
		`Install size: ${counted.toFixed(1)} MB of ${budgetMB} MB budget ` +
			`(${toMB(totalBytes).toFixed(1)} MB with the Agent SDK's ` +
			`${toMB(agentSdkBinaryBytes).toFixed(1)} MB Claude Code binary)`
	);
	if (counted > budgetMB) {
		console.error(
			`Install is over budget by ${(counted - budgetMB).toFixed(1)} MB. ` +
				'Run `du -sh node_modules/* | sort -h` on a clean install to find the new weight.'
		);
		process.exit(1);
	}
}
