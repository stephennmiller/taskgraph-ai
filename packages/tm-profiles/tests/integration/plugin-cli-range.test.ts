/**
 * The plugin's `metadata.taskgraphCli` range must allow only CLIs that have
 * every command and flag the plugin runs (#488). Bodies and hooks are
 * checked against plugin-cli-surface.json, the commands and flags of the
 * range's minimum, which cli-surface.ts writes from that release's tag.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { minimumVersion } from '../../../tm-core/src/modules/setup/version-range.js';
import {
	type CliSurface,
	codeLines,
	hookLines,
	invocations,
	SNAPSHOT_FILE,
	unknownFlags,
	unknownStandaloneFlags
} from './cli-surface.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const pluginDir = join(repoRoot, 'packages/claude-code-plugin');
const range: string = JSON.parse(
	readFileSync(join(pluginDir, '.claude-plugin/plugin.json'), 'utf-8')
).metadata.taskgraphCli;
const minimum = minimumVersion(range);

const snapshot: { version: string; commands: Record<string, string[]> } =
	JSON.parse(readFileSync(SNAPSHOT_FILE, 'utf-8'));
const surface: CliSurface = new Map(
	Object.entries(snapshot.commands).map(([name, flags]) => [
		name,
		new Set(flags)
	])
);

/** What `taskgraph <minimum>` lacks among the given calls */
function missing(
	calls: ReturnType<typeof invocations>,
	markdown = ''
): string[] {
	return [
		...calls
			.filter(({ command }) => !surface.has(command))
			.map(({ command }) => command),
		...unknownFlags(
			calls.filter(({ command }) => surface.has(command)),
			surface
		),
		...unknownStandaloneFlags(markdown, surface)
	];
}

const raise = `The plugin uses these, which taskgraph ${minimum} lacks. Raise metadata.taskgraphCli (${range}) in packages/claude-code-plugin/.claude-plugin/plugin.json to the first release that has them, then regenerate the snapshot: node packages/tm-profiles/tests/integration/cli-surface.ts v<that version>`;

const markdownFiles = readdirSync(pluginDir, {
	recursive: true,
	encoding: 'utf-8'
})
	.filter((file) => file.endsWith('.md') && !file.startsWith('CHANGELOG'))
	.sort();

const hooks: Record<
	string,
	Array<{ hooks: Array<{ command: string }> }>
> = JSON.parse(
	readFileSync(join(pluginDir, 'hooks/hooks.json'), 'utf-8')
).hooks;
/** Each hook's script, which its command runs by name */
const hookCommands = Object.entries(hooks).flatMap(([event, groups]) =>
	groups.flatMap((group) =>
		group.hooks.map((hook) => {
			const script = hook.command.match(/\/(hooks\/[\w-]+\.sh)/)?.[1];
			if (!script) throw new Error(`${event} runs no hooks/*.sh script`);
			return [event, readFileSync(join(pluginDir, script), 'utf-8')] as const;
		})
	)
);

describe('plugin CLI range', () => {
	it('is a minimum', () => {
		expect(minimum, `${range} is not a >=x.y.z range`).not.toBeNull();
	});

	it('has a snapshot of the minimum CLI', () => {
		expect(
			snapshot.version,
			`Regenerate the snapshot for ${range}: node packages/tm-profiles/tests/integration/cli-surface.ts v${minimum}`
		).toBe(minimum);
	});

	it('reports a command or flag the minimum lacks', () => {
		const calls = invocations(
			codeLines(
				'```bash\ntaskgraph set-status --id=1 --brand-new\ntaskgraph no-such-command\n```'
			)
		);

		expect(missing(calls)).toEqual([
			'no-such-command',
			'set-status --brand-new'
		]);
	});

	it('reads the calls in a hook', () => {
		const calls = hookCommands.flatMap(([, command]) =>
			invocations(hookLines(command))
		);

		expect(calls).toContainEqual({
			command: 'prime',
			flags: ['project', 'plugin-root']
		});
	});

	it.each(markdownFiles)(
		'%s uses only commands and flags the minimum has',
		(file) => {
			const markdown = readFileSync(join(pluginDir, file), 'utf-8');

			expect(
				missing(invocations(codeLines(markdown)), markdown),
				raise
			).toEqual([]);
		}
	);

	it.each(hookCommands)(
		'the %s hook uses only commands and flags the minimum has',
		(_event, command) => {
			expect(missing(invocations(hookLines(command))), raise).toEqual([]);
		}
	);
});
