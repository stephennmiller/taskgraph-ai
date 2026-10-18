/**
 * The Hamster cloud integration is removed (issue #16), so its commands must
 * not be registered.
 *
 * Reads the registry source instead of importing it: importing the registry
 * pulls in the legacy task-manager modules, which import @tm/cli back and fail
 * at load time when started from a spec.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REGISTRY_SOURCE = readFileSync(
	join(dirname(fileURLToPath(import.meta.url)), 'command-registry.ts'),
	'utf8'
);
const REGISTERED = [
	...REGISTRY_SOURCE.matchAll(/^\t\t\tname: '([^']+)'/gm)
].map((match) => match[1]);

const REMOVED_COMMANDS = [
	'auth',
	'login',
	'logout',
	'context',
	'briefs',
	'export',
	'export-tag'
];

describe('CommandRegistry', () => {
	it.each(REMOVED_COMMANDS)('does not register "%s"', (name) => {
		expect(REGISTERED).not.toContain(name);
	});

	it('has no commands in the auth category', () => {
		expect(REGISTRY_SOURCE).not.toMatch(/category: 'auth'/);
	});

	it('still registers the local task commands', () => {
		expect(REGISTERED).toEqual(
			expect.arrayContaining(['list', 'show', 'next', 'set-status', 'tags'])
		);
	});
});
