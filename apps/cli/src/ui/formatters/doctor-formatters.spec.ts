import type { DoctorCheck, DoctorReport } from '@tm/core';
import { describe, expect, it } from 'vitest';
import { formatDoctorReport } from './doctor-formatters.js';

const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');

const CWD = '/home/me/app';

const report = (
	checks: DoctorCheck[],
	cliVersion = '0.58.0'
): DoctorReport => ({
	checks,
	cliVersion,
	ok: checks.every((check) => check.status !== 'fail')
});

const format = (checks: DoctorCheck[], cliVersion?: string) =>
	plain(formatDoctorReport(report(checks, cliVersion), { cwd: CWD }));

const allPass: DoctorCheck[] = [
	{ name: 'node', status: 'pass', detail: '22.13.0' },
	{ name: 'claude', status: 'pass', detail: '2.1.309' },
	{ name: 'signed-in', status: 'pass' },
	{ name: 'project', status: 'pass', detail: CWD },
	{ name: 'plugin', status: 'pass', detail: '0.58.0' },
	{ name: 'mcp', status: 'pass', detail: '.mcp.json' }
];

describe('formatDoctorReport', () => {
	it('prints one aligned ✓ line per check when all pass', () => {
		expect(format(allPass)).toBe(
			[
				'✓ Node            22.13.0',
				'✓ Claude Code     2.1.309',
				'✓ Claude sign-in  signed in',
				'✓ Project         .',
				'✓ Plugin          0.58.0',
				'✓ MCP server      .mcp.json'
			].join('\n')
		);
	});

	it('shows a project above the current folder relative to it', () => {
		const output = format([
			{ name: 'project', status: 'pass', detail: '/home/me' }
		]);

		expect(output).toBe('✓ Project  ..');
	});

	it('marks an unset MCP server as optional, with how to add it', () => {
		const output = format([
			{ name: 'mcp', status: 'skip', problem: 'not-set-up' }
		]);

		expect(output).toBe(
			'– MCP server  optional; add it with taskgraph init --mcp'
		);
	});

	it('leaves out checks skipped because an earlier one failed', () => {
		const output = format([
			{ name: 'node', status: 'pass', detail: '22.13.0' },
			{ name: 'claude', status: 'fail', problem: 'not-found' },
			{ name: 'signed-in', status: 'skip' },
			{ name: 'project', status: 'pass', detail: CWD },
			{ name: 'plugin', status: 'skip' },
			{ name: 'mcp', status: 'skip', problem: 'not-set-up' }
		]);

		expect(output).toBe(
			[
				'✓ Node         22.13.0',
				'✗ Claude Code  not found',
				'  Install it: npm install -g @anthropic-ai/claude-code',
				'✓ Project      .',
				'– MCP server   optional; add it with taskgraph init --mcp'
			].join('\n')
		);
	});

	it.each<[string, DoctorCheck, string[]]>([
		[
			'an old Node',
			{
				name: 'node',
				status: 'fail',
				detail: '20.11.0',
				problem: 'too-old',
				required: '>=22.13.0'
			},
			['✗ Node  20.11.0, needs >=22.13.0', '  Install Node 22.13.0 or later']
		],
		[
			'a signed-out Claude Code',
			{ name: 'signed-in', status: 'fail', problem: 'signed-out' },
			['✗ Claude sign-in  signed out', '  Run claude auth login']
		],
		[
			'no project',
			{ name: 'project', status: 'fail', detail: CWD, problem: 'not-found' },
			[
				'✗ Project  none in this folder',
				'  Run taskgraph init to set one up, or cd into your project'
			]
		],
		[
			'a missing plugin',
			{ name: 'plugin', status: 'fail', problem: 'not-installed' },
			[
				'✗ Plugin  not installed',
				'  In Claude Code, run /plugin marketplace add stephennmiller/taskgraph-ai',
				'  then /plugin install taskgraph@taskgraph'
			]
		],
		[
			'a disabled plugin',
			{ name: 'plugin', status: 'fail', detail: '0.58.0', problem: 'disabled' },
			['✗ Plugin  disabled', '  Run claude plugin enable taskgraph@taskgraph']
		],
		[
			'a CLI older than the plugin needs',
			{
				name: 'plugin',
				status: 'fail',
				detail: '0.60.0',
				problem: 'too-old',
				required: '>=0.60.0'
			},
			[
				'✗ Plugin  0.60.0 needs taskgraph >=0.60.0; this is 0.57.1',
				'  Run npm install -g taskgraph-ai@latest'
			]
		]
	])('gives %s a ✗ line and the fix under it', (_, check, expected) => {
		expect(format([check], '0.57.1')).toBe(expected.join('\n'));
	});

	it('fits 80 columns', () => {
		const output = format([
			...allPass.slice(0, 4),
			{ name: 'plugin', status: 'fail', problem: 'not-installed' },
			{
				name: 'node',
				status: 'fail',
				detail: '20.11.0',
				problem: 'too-old',
				required: '>=22.13.0'
			}
		]);

		for (const line of output.split('\n')) {
			expect(line.length).toBeLessThanOrEqual(80);
		}
	});

	it('strips escape sequences from what it found', () => {
		const output = format([
			{ name: 'claude', status: 'pass', detail: '2.1\x1b]0;pwned\x07.309' }
		]);

		expect(output).not.toContain('\x1b');
		expect(output).not.toContain('\x07');
	});
});
