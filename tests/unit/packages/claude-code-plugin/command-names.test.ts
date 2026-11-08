/**
 * The plugin tells Claude which CLI commands to run. An old name still works
 * but prints "(add-dependency is now taskgraph depend)" on every run, so the
 * plugin must use the current names.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../../../../packages/claude-code-plugin'
);

// Hidden aliases: the noticeOldAlias / warnDeprecated calls in apps/cli/src/commands
const OLD_NAMES = [
	'update-task',
	'complexity-report',
	'add-dependency',
	'remove-dependency',
	'validate-dependencies',
	'remove-subtask',
	'scope-up',
	'scope-down',
	'add-tag',
	'use-tag',
	'delete-tag',
	'rename-tag',
	'copy-tag'
];

function markdownFiles(dir: string): string[] {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) return markdownFiles(full);
		return entry.name.endsWith('.md') ? [full] : [];
	});
}

const oldCall = new RegExp(`\\btaskgraph (${OLD_NAMES.join('|')})\\b`, 'g');

describe('plugin command names', () => {
	it.each(markdownFiles(pluginDir).map((f) => path.relative(pluginDir, f)))(
		'%s runs no old command name',
		(file) => {
			const text = fs.readFileSync(path.join(pluginDir, file), 'utf8');
			expect(text.match(oldCall) ?? []).toEqual([]);
		}
	);
});
