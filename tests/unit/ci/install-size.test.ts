import {
	linkSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	isAgentSdkBinary,
	measureInstall,
	parseBudgetMB
} from '../../../.github/scripts/check-install-size.mjs';

describe('isAgentSdkBinary', () => {
	it.each([
		['node_modules/@anthropic-ai/claude-agent-sdk-linux-x64', true],
		['node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64', true],
		['node_modules/@anthropic-ai/claude-agent-sdk-linux-arm64-musl', true],
		['node_modules/@anthropic-ai/claude-agent-sdk-win32-x64', true],
		['node_modules/@anthropic-ai/claude-agent-sdk-tools', false],
		['node_modules/@anthropic-ai/claude-agent-sdk-linux-x64-extra', false],
		['node_modules/@anthropic-ai/claude-agent-sdk', false],
		['node_modules/@anthropic-ai/sdk', false],
		['node_modules/claude-agent-sdk-linux-x64', false]
	])('%s -> %s', (dir, expected) => {
		expect(isAgentSdkBinary(dir)).toBe(expected);
	});
});

describe('parseBudgetMB', () => {
	it('defaults to 150 MB without an argument', () => {
		expect(parseBudgetMB(undefined)).toBe(150);
	});

	it('reads a number of MB', () => {
		expect(parseBudgetMB('200')).toBe(200);
		expect(parseBudgetMB('99.5')).toBe(99.5);
	});

	it.each(['150MB', 'abc', '', ' ', '0', '-5', 'Infinity'])(
		'rejects %j instead of passing every install',
		(arg) => {
			expect(() => parseBudgetMB(arg)).toThrow(/positive number/);
		}
	);
});

describe('measureInstall', () => {
	let root: string;

	const file = (relative: string, bytes: number) => {
		const path = join(root, relative);
		mkdirSync(join(path, '..'), { recursive: true });
		writeFileSync(path, Buffer.alloc(bytes));
	};

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), 'install-size-'));
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it('sums file sizes and reports the Agent SDK binary separately', () => {
		file('chalk/index.js', 100);
		file('@anthropic-ai/claude-agent-sdk/sdk.mjs', 50);
		file('@anthropic-ai/claude-agent-sdk-linux-x64/claude', 1000);
		file(
			'ai-sdk-provider-claude-code/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64-musl/claude',
			500
		);

		expect(measureInstall(root)).toEqual({
			totalBytes: 1650,
			agentSdkBinaryBytes: 1500
		});
	});

	it('counts a hard-linked file once', () => {
		file('a/bin', 300);
		mkdirSync(join(root, 'b'));
		linkSync(join(root, 'a/bin'), join(root, 'b/bin'));

		expect(measureInstall(root).totalBytes).toBe(300);
	});
});
