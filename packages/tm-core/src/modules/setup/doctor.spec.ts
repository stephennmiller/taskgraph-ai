import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	type CommandRunner,
	type DoctorCheck,
	createCommandRunner,
	runDoctor
} from './doctor.js';

const dirs: string[] = [];
const tempDir = (prefix: string) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	dirs.push(dir);
	return dir;
};

afterEach(() => {
	for (const dir of dirs.splice(0)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

/** A TaskGraph project, optionally with a .mcp.json */
function project(mcp?: object): string {
	const root = tempDir('tg-doctor-project-');
	fs.mkdirSync(path.join(root, '.taskgraph'));
	fs.writeFileSync(path.join(root, '.taskgraph', 'config.json'), '{}');
	if (mcp) fs.writeFileSync(path.join(root, '.mcp.json'), JSON.stringify(mcp));
	return root;
}

/** An installed plugin folder with this manifest */
function installedPlugin(manifest: object): string {
	const root = tempDir('tg-doctor-plugin-');
	fs.mkdirSync(path.join(root, '.claude-plugin'));
	fs.writeFileSync(
		path.join(root, '.claude-plugin', 'plugin.json'),
		JSON.stringify(manifest)
	);
	return root;
}

/** A fake `claude` that answers each subcommand; missing answers fail */
function claude(answers: {
	version?: string;
	auth?: object;
	plugins?: object[];
}): CommandRunner {
	return async (_command, args) => {
		const key = args.join(' ');
		if (key === '--version') return answers.version ?? null;
		if (key === 'auth status --json') {
			return answers.auth ? JSON.stringify(answers.auth) : null;
		}
		if (key === 'plugin list --json') {
			return answers.plugins ? JSON.stringify(answers.plugins) : null;
		}
		return null;
	};
}

const noClaude: CommandRunner = async () => null;

const byName = (checks: DoctorCheck[]) =>
	Object.fromEntries(checks.map((check) => [check.name, check]));

describe('runDoctor', () => {
	it('passes a complete setup', async () => {
		const root = project({
			mcpServers: {
				'taskgraph-ai': { command: 'npx', args: ['-y', 'taskgraph-ai'] }
			}
		});
		const pluginPath = installedPlugin({
			version: '0.58.0',
			metadata: { taskgraphCli: '>=0.57.2' }
		});

		const report = await runDoctor({
			projectPath: root,
			nodeVersion: '22.13.0',
			cliVersion: '0.58.0',
			run: claude({
				version: '2.1.309 (Claude Code)\n',
				auth: { loggedIn: true },
				plugins: [
					{ id: 'taskgraph@taskgraph', enabled: true, installPath: pluginPath }
				]
			})
		});

		expect(report.ok).toBe(true);
		expect(report.cliVersion).toBe('0.58.0');
		expect(report.checks).toEqual([
			{ name: 'node', status: 'pass', detail: '22.13.0' },
			{ name: 'claude', status: 'pass', detail: '2.1.309' },
			{ name: 'signed-in', status: 'pass' },
			{ name: 'project', status: 'pass', detail: root },
			{ name: 'plugin', status: 'pass', detail: '0.58.0' },
			{ name: 'mcp', status: 'pass', detail: '.mcp.json' }
		]);
	});

	it('fails an old Node with the range it needs', async () => {
		const report = await runDoctor({
			projectPath: project(),
			nodeVersion: '20.11.0',
			run: noClaude
		});

		expect(byName(report.checks).node).toEqual({
			name: 'node',
			status: 'fail',
			detail: '20.11.0',
			problem: 'too-old',
			required: expect.stringMatching(/^>=\d+\.\d+\.\d+$/)
		});
	});

	it('skips the sign-in and plugin checks when claude is missing', async () => {
		const report = await runDoctor({
			projectPath: project(),
			nodeVersion: '22.13.0',
			run: noClaude
		});
		const checks = byName(report.checks);

		expect(report.ok).toBe(false);
		expect(checks.claude).toEqual({
			name: 'claude',
			status: 'fail',
			problem: 'not-found'
		});
		expect(checks['signed-in'].status).toBe('skip');
		expect(checks.plugin.status).toBe('skip');
	});

	it('fails when Claude Code is signed out', async () => {
		const report = await runDoctor({
			projectPath: project(),
			nodeVersion: '22.13.0',
			run: claude({
				version: '2.1.309',
				auth: { loggedIn: false },
				plugins: []
			})
		});

		expect(byName(report.checks)['signed-in']).toEqual({
			name: 'signed-in',
			status: 'fail',
			problem: 'signed-out'
		});
	});

	it('fails when the plugin is not installed, or is disabled', async () => {
		const run = (plugins: object[]) =>
			runDoctor({
				projectPath: project(),
				nodeVersion: '22.13.0',
				run: claude({ version: '2.1.309', auth: { loggedIn: true }, plugins })
			});

		const missing = await run([{ id: 'other@market', enabled: true }]);
		const disabled = await run([{ id: 'taskgraph@taskgraph', enabled: false }]);

		expect(byName(missing.checks).plugin).toEqual({
			name: 'plugin',
			status: 'fail',
			problem: 'not-installed'
		});
		expect(byName(disabled.checks).plugin).toMatchObject({
			status: 'fail',
			problem: 'disabled'
		});
	});

	it('fails when this CLI is older than the installed plugin needs', async () => {
		const pluginPath = installedPlugin({
			version: '0.60.0',
			metadata: { taskgraphCli: '>=0.60.0' }
		});

		const report = await runDoctor({
			projectPath: project(),
			nodeVersion: '22.13.0',
			cliVersion: '0.57.1',
			run: claude({
				version: '2.1.309',
				auth: { loggedIn: true },
				plugins: [
					{ id: 'taskgraph@taskgraph', enabled: true, installPath: pluginPath }
				]
			})
		});

		expect(byName(report.checks).plugin).toEqual({
			name: 'plugin',
			status: 'fail',
			detail: '0.60.0',
			problem: 'too-old',
			required: '>=0.60.0'
		});
	});

	it('fails outside a project and leaves the MCP check out', async () => {
		const dir = tempDir('tg-doctor-none-');

		const report = await runDoctor({
			projectPath: dir,
			nodeVersion: '22.13.0',
			run: noClaude
		});
		const checks = byName(report.checks);

		expect(checks.project).toEqual({
			name: 'project',
			status: 'fail',
			detail: dir,
			problem: 'not-found'
		});
		expect(checks.mcp).toEqual({ name: 'mcp', status: 'skip' });
	});

	it('finds the MCP server in Claude Code config, for this project or all', async () => {
		const root = project();
		const configFile = path.join(tempDir('tg-doctor-home-'), '.claude.json');
		const server = { command: 'npx', args: ['-y', 'taskgraph-ai'] };
		const mcpFrom = async (config: object, projectPath = root) => {
			fs.writeFileSync(configFile, JSON.stringify(config));
			const report = await runDoctor({
				projectPath,
				nodeVersion: '22.13.0',
				run: noClaude,
				claudeConfigFile: configFile
			});
			return byName(report.checks).mcp;
		};

		// Claude Code keys projects by the real path, with / on Windows
		const linked = path.join(tempDir('tg-doctor-link-'), 'project');
		fs.symlinkSync(root, linked, 'junction');
		const realKey = fs.realpathSync(root).replace(/\\/g, '/');
		expect(
			(
				await mcpFrom(
					{ projects: { [realKey]: { mcpServers: { tg: server } } } },
					linked
				)
			).status
		).toBe('pass');

		expect(
			await mcpFrom({ projects: { [root]: { mcpServers: { tg: server } } } })
		).toEqual({
			name: 'mcp',
			status: 'pass',
			detail: 'Claude Code, this project'
		});
		expect(await mcpFrom({ mcpServers: { 'taskgraph-ai': server } })).toEqual({
			name: 'mcp',
			status: 'pass',
			detail: 'Claude Code, all projects'
		});
	});

	it('treats a missing MCP server as optional, not a failure', async () => {
		const report = await runDoctor({
			projectPath: project({ mcpServers: { other: { args: ['x'] } } }),
			claudeConfigFile: path.join(tempDir('tg-doctor-home-'), '.claude.json'),
			nodeVersion: '22.13.0',
			run: claude({ version: '2.1.309', auth: { loggedIn: true }, plugins: [] })
		});

		expect(byName(report.checks).mcp).toEqual({
			name: 'mcp',
			status: 'skip',
			problem: 'not-set-up'
		});
	});

	it('skips checks whose output it cannot read instead of failing them', async () => {
		const run: CommandRunner = async (_command, args) =>
			args[0] === '--version' ? '2.1.309' : 'not json';

		const report = await runDoctor({
			projectPath: project(),
			nodeVersion: '22.13.0',
			run
		});
		const checks = byName(report.checks);

		expect(checks['signed-in'].status).toBe('skip');
		expect(checks.plugin.status).toBe('skip');
	});

	it('uses the entry for this project, and an enabled one, when the plugin is listed per scope', async () => {
		const root = project();
		const pluginPath = installedPlugin({ version: '0.58.1' });

		const report = await runDoctor({
			projectPath: root,
			nodeVersion: '22.13.0',
			run: claude({
				version: '2.1.309',
				auth: { loggedIn: true },
				plugins: [
					{
						id: 'taskgraph@taskgraph',
						scope: 'local',
						projectPath: '/somewhere/else',
						enabled: false
					},
					{ id: 'taskgraph@taskgraph', scope: 'project', enabled: false },
					{
						id: 'taskgraph@taskgraph',
						scope: 'user',
						enabled: true,
						readFromFolder: pluginPath
					}
				]
			})
		});

		expect(byName(report.checks).plugin).toEqual({
			name: 'plugin',
			status: 'pass',
			detail: '0.58.1'
		});
	});
});

describe('createCommandRunner', () => {
	const node = process.execPath;
	// On Windows the runner joins the command into one shell string, which
	// these inline scripts don't survive
	const posix = process.platform !== 'win32';

	it('resolves null when the command does not exist', async () => {
		const run = createCommandRunner(5_000);

		expect(await run('taskgraph-no-such-command', [], os.tmpdir())).toBeNull();
	});

	it.runIf(posix)(
		'keeps the output of a command that exits non-zero, as claude auth status does when signed out',
		async () => {
			const run = createCommandRunner(5_000);

			const out = await run(
				node,
				['-e', 'console.log(JSON.stringify({loggedIn:false}));process.exit(1)'],
				os.tmpdir()
			);

			expect(JSON.parse(out ?? '')).toEqual({ loggedIn: false });
		}
	);

	it.runIf(posix)(
		'gives up on a command that runs past the deadline',
		async () => {
			const run = createCommandRunner(200);
			const started = Date.now();

			const out = await run(
				node,
				['-e', 'console.log("partial");setTimeout(()=>{},10000)'],
				os.tmpdir()
			);

			expect(out).toBeNull();
			expect(Date.now() - started).toBeLessThan(5_000);
		}
	);
});
