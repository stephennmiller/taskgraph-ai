/**
 * evals/baseline.json is committed, so it must pass CI's Format Check. JSON
 * with tab indents puts each array item on its own line, which Biome collapses
 * (#724), so the baseline is run through Biome with the repo's config.
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const biome = fileURLToPath(import.meta.resolve('@biomejs/biome/bin/biome'));

/** `value` as JSON formatted the way `npm run format` leaves `filePath` */
export function biomeFormattedJson(
	value: unknown,
	repoRoot: string,
	filePath: string
): string {
	const result = spawnSync(
		process.execPath,
		[biome, 'format', `--stdin-file-path=${filePath}`],
		{
			cwd: repoRoot,
			input: JSON.stringify(value, null, '\t'),
			encoding: 'utf8'
		}
	);
	if (result.status !== 0) {
		throw new Error(
			`biome format failed: ${result.error?.message ?? result.stderr}`
		);
	}
	return result.stdout;
}
