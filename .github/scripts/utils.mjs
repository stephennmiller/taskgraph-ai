#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// Find the root directory by looking for package.json with taskgraph-ai
export function findRootDir(startDir) {
	let currentDir = resolve(startDir);
	while (currentDir !== '/') {
		const pkgPath = join(currentDir, 'package.json');
		try {
			const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
			if (pkg.name === 'taskgraph-ai' || pkg.repository) {
				return currentDir;
			}
		} catch {}
		currentDir = dirname(currentDir);
	}
	throw new Error('Could not find root directory');
}
