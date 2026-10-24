/**
 * @fileoverview The files `init` copies into a project (`assets/` in the repo,
 * `dist/assets/` in the built package; the build copies it there).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The assets folder, found by its AGENTS.md: dist/assets beside the bundle,
 * or assets/ at the repo root when running from source
 * @throws When there is none (a packaging bug)
 */
export function getAssetsDir(): string {
	let dir = path.dirname(fileURLToPath(import.meta.url));
	for (;;) {
		const assets = path.join(dir, 'assets');
		if (fs.existsSync(path.join(assets, 'AGENTS.md'))) return assets;
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	throw new Error(
		'Assets directory not found. This is likely a packaging issue.'
	);
}

/** Read `assets/<name>` as text */
export function readAsset(name: string): string {
	return fs.readFileSync(path.join(getAssetsDir(), name), 'utf8');
}
