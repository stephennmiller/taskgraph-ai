import { execFile } from 'node:child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GhCliClient } from './gh-cli-client.js';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));

const execFileMock = vi.mocked(execFile) as unknown as ReturnType<typeof vi.fn>;
const stdinEnd = vi.fn();

/** Queue `gh api -i` style responses: status line, headers, blank line, body */
function respond(
	status: number,
	body: unknown,
	headers: Record<string, string> = {}
) {
	const head = Object.entries(headers).map(([k, v]) => `${k}: ${v}\r\n`);
	const stdout = `HTTP/2.0 ${status} X\r\n${head.join('')}\r\n${JSON.stringify(body)}`;
	execFileMock.mockImplementationOnce(
		(
			_cmd: string,
			_args: string[],
			_opts: unknown,
			cb: (e: Error | null, out: string, err: string) => void
		) => {
			cb(status >= 400 ? new Error('exit 1') : null, stdout, '');
			return { stdin: { end: stdinEnd } };
		}
	);
}

const rawIssue = (number: number, extra: Record<string, unknown> = {}) => ({
	number,
	html_url: `https://github.com/acme/app/issues/${number}`,
	title: `t${number}`,
	body: 'b',
	labels: [{ name: 'taskgraph' }],
	state: 'open',
	state_reason: null,
	...extra
});

const callArgs = (index: number) =>
	execFileMock.mock.calls[index][1] as string[];

describe('GhCliClient', () => {
	let client: GhCliClient;
	const sleep = vi.fn(() => Promise.resolve());

	beforeEach(() => {
		execFileMock.mockReset();
		stdinEnd.mockReset();
		sleep.mockClear();
		client = new GhCliClient('acme/app', { sleep });
	});

	it('lists issues by label via execFile with an argument array, skipping pull requests', () => {
		respond(200, [rawIssue(1), rawIssue(2, { pull_request: {} })]);

		return client.listIssues('taskgraph').then((issues) => {
			expect(execFileMock.mock.calls[0][0]).toBe('gh');
			expect(callArgs(0)).toEqual([
				'api',
				'-i',
				'-X',
				'GET',
				'repos/acme/app/issues?labels=taskgraph&state=all&per_page=100&page=1'
			]);
			expect(issues).toEqual([
				{
					number: 1,
					url: 'https://github.com/acme/app/issues/1',
					title: 't1',
					body: 'b',
					labels: ['taskgraph'],
					state: 'open',
					stateReason: undefined
				}
			]);
		});
	});

	it('sends request bodies on stdin and never in the arguments', () => {
		const title = '$(touch pwned); `rm -rf /` "quoted"';
		respond(201, rawIssue(5, { title }));

		return client
			.createIssue({ title, body: 'x', labels: ['taskgraph'] })
			.then(() => {
				const args = callArgs(0);
				expect(args).toEqual([
					'api',
					'-i',
					'-X',
					'POST',
					'repos/acme/app/issues',
					'--input',
					'-'
				]);
				expect(args.join(' ')).not.toContain('pwned');
				expect(JSON.parse(stdinEnd.mock.calls[0][0])).toEqual({
					title,
					body: 'x',
					labels: ['taskgraph']
				});
			});
	});

	it('closes an issue with a state reason', () => {
		respond(200, rawIssue(5, { state: 'closed', state_reason: 'not_planned' }));

		return client
			.updateIssue(5, { state: 'closed', stateReason: 'not_planned' })
			.then((issue) => {
				expect(callArgs(0).slice(2, 5)).toEqual([
					'-X',
					'PATCH',
					'repos/acme/app/issues/5'
				]);
				expect(JSON.parse(stdinEnd.mock.calls[0][0])).toEqual({
					state: 'closed',
					state_reason: 'not_planned'
				});
				expect(issue.stateReason).toBe('not_planned');
			});
	});

	it('creates only the labels that are missing', () => {
		respond(200, [{ name: 'taskgraph' }]);
		respond(201, { name: 'taskgraph:tag/a' });

		return client.ensureLabels(['taskgraph', 'taskgraph:tag/a']).then(() => {
			expect(execFileMock).toHaveBeenCalledTimes(2);
			expect(callArgs(1)).toContain('repos/acme/app/labels');
			expect(JSON.parse(stdinEnd.mock.calls[1][0]).name).toBe(
				'taskgraph:tag/a'
			);
		});
	});

	it('waits for Retry-After on a rate limit, then retries', () => {
		respond(403, { message: 'secondary rate limit' }, { 'Retry-After': '3' });
		respond(201, rawIssue(6));

		return client
			.createIssue({ title: 't', body: 'b', labels: [] })
			.then((issue) => {
				expect(sleep).toHaveBeenCalledWith(3000);
				expect(execFileMock).toHaveBeenCalledTimes(2);
				expect(issue.number).toBe(6);
			});
	});

	it('throws a readable error on other failures', () => {
		respond(404, { message: 'Not Found' });

		return expect(client.listIssues('taskgraph')).rejects.toThrow(
			/404.*Not Found/
		);
	});

	it('lists open issues with any label when no label is given', () => {
		respond(200, [rawIssue(1)]);

		return client.listIssues(undefined, 'open').then(() => {
			expect(callArgs(0)[4]).toBe(
				'repos/acme/app/issues?state=open&per_page=100&page=1'
			);
		});
	});

	it('reads every page of unlabelled issues, counting pull requests toward a full page', () => {
		const page1 = Array.from({ length: 100 }, (_, i) =>
			rawIssue(i + 1, i === 0 ? { pull_request: {} } : {})
		);
		respond(200, page1);
		respond(200, [rawIssue(101)]);

		return client.listIssues(undefined, 'all').then((issues) => {
			expect(callArgs(1)[4]).toBe(
				'repos/acme/app/issues?state=all&per_page=100&page=2'
			);
			expect(issues).toHaveLength(100);
			expect(execFileMock).toHaveBeenCalledTimes(2);
		});
	});

	it('reads the repo from the API', () => {
		respond(200, {
			full_name: 'acme/app',
			html_url: 'https://github.com/acme/app'
		});

		return client.getRepo().then((repo) => {
			expect(repo).toEqual({
				fullName: 'acme/app',
				url: 'https://github.com/acme/app'
			});
		});
	});
});
