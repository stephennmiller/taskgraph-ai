/**
 * @fileoverview Tests for the fake `claude` program used to run the built CLI
 * and MCP server without real AI calls.
 *
 * The fake speaks the stream-json protocol that ai-sdk-provider-claude-code
 * uses with the Claude Code executable: it answers the `initialize` control
 * request, then answers the user message with a structured or plain result.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installFakeClaude, readTrace } from '../fakes/install-fake-claude.mjs';
import { sampleFromSchema } from '../fakes/schema-sample.mjs';

const fakeClaude = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../fakes/fake-claude.mjs'
);

type Message = Record<string, any>;

let dir: string;

beforeEach(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-claude-'));
});

afterEach(() => {
	fs.rmSync(dir, { recursive: true, force: true });
});

const initialize = {
	type: 'control_request',
	request_id: 'req-1',
	request: { subtype: 'initialize' }
};
const userMessage = (text: string) => ({
	type: 'user',
	session_id: '',
	message: { role: 'user', content: [{ type: 'text', text }] }
});

/** Run the fake once the way the SDK does and return what it wrote. */
const run = (
	messages: Message[],
	{ schema, env = {} }: { schema?: object; env?: Record<string, string> } = {}
) => {
	const args = ['--output-format', 'stream-json', '--model', 'sonnet'];
	if (schema) args.push('--json-schema', JSON.stringify(schema));
	const res = spawnSync(process.execPath, [fakeClaude, ...args], {
		input: `${messages.map((m) => JSON.stringify(m)).join('\n')}\n`,
		encoding: 'utf8',
		timeout: 10000,
		env: { ...process.env, FAKE_CLAUDE_DIR: dir, ...env }
	});
	const out: Message[] = res.stdout
		.split('\n')
		.filter(Boolean)
		.map((line) => JSON.parse(line));
	return {
		status: res.status,
		out,
		result: out.find((m) => m.type === 'result')
	};
};

describe('fake claude program', () => {
	it('answers the initialize request with a matching success response', () => {
		const { out } = run([initialize]);

		expect(out).toEqual([
			{
				type: 'control_response',
				response: { subtype: 'success', request_id: 'req-1', response: {} }
			}
		]);
	});

	it('answers a user message with system, assistant and result messages', () => {
		const { status, out } = run([initialize, userMessage('hi')]);

		expect(status).toBe(0);
		expect(out.map((m) => m.type)).toEqual([
			'control_response',
			'system',
			'assistant',
			'result'
		]);
	});

	it('returns structured output built from the --json-schema flag', () => {
		const schema = {
			type: 'object',
			properties: {
				title: { type: 'string' },
				count: { type: 'integer' }
			}
		};

		const { result } = run([initialize, userMessage('hi')], { schema });

		expect(result?.is_error).toBe(false);
		expect(result?.structured_output).toEqual(sampleFromSchema(schema));
		expect(typeof result?.structured_output.title).toBe('string');
		expect(result?.structured_output.count).toBe(1);
	});

	it('returns plain text when no schema was passed', () => {
		const { result } = run([initialize, userMessage('hi')]);

		expect(result?.is_error).toBe(false);
		expect(typeof result?.result).toBe('string');
		expect(result?.structured_output).toBeUndefined();
	});

	it('uses canned replies in call order, then falls back to generated ones', () => {
		fs.writeFileSync(
			path.join(dir, 'replies.json'),
			JSON.stringify([{ object: { title: 'First' } }, { text: 'Second' }])
		);
		const schema = {
			type: 'object',
			properties: { title: { type: 'string' } }
		};

		const first = run([initialize, userMessage('a')], { schema });
		const second = run([initialize, userMessage('b')]);
		const third = run([initialize, userMessage('c')], { schema });

		expect(first.result?.structured_output).toEqual({ title: 'First' });
		expect(second.result?.result).toBe('Second');
		expect(third.result?.structured_output).toEqual(sampleFromSchema(schema));
	});

	it('returns an error result for a canned error reply', () => {
		fs.writeFileSync(
			path.join(dir, 'replies.json'),
			JSON.stringify([{ error: 'model is overloaded' }])
		);

		const { result } = run([initialize, userMessage('a')]);

		expect(result?.is_error).toBe(true);
		expect(result?.subtype).toBe('error_during_execution');
		expect(result?.result).toBe('model is overloaded');
		// the SDK reads errors.map(...) on every non-success result
		expect(result?.errors).toEqual(['model is overloaded']);
	});

	it('records every call in the trace', () => {
		const schema = {
			type: 'object',
			properties: { title: { type: 'string' } }
		};

		run([initialize, userMessage('first prompt')], { schema });
		run([initialize, userMessage('second prompt')]);

		const trace = readTrace(dir);
		expect(trace.map((t) => t.n)).toEqual([0, 1]);
		expect(trace[0].prompt).toBe('first prompt');
		expect(trace[0].schema).toEqual(schema);
		expect(trace[0].args).toContain('sonnet');
		expect(trace[1].prompt).toBe('second prompt');
		expect(trace[1].schema).toBeNull();
	});

	it('skips a trace line the fake is still writing', () => {
		fs.writeFileSync(
			path.join(dir, 'trace.jsonl'),
			`${JSON.stringify({ n: 0, prompt: 'done' })}\n{"n":1,"prompt":"half`
		);

		expect(readTrace(dir).map((t) => t.prompt)).toEqual(['done']);
	});

	it('works without a FAKE_CLAUDE_DIR', () => {
		const res = spawnSync(process.execPath, [fakeClaude], {
			input: `${JSON.stringify(userMessage('hi'))}\n`,
			encoding: 'utf8',
			timeout: 10000,
			env: { ...process.env, FAKE_CLAUDE_DIR: '' }
		});

		expect(res.status).toBe(0);
		expect(res.stdout).toContain('"type":"result"');
	});
	it('records the initialize request in the trace', () => {
		run([initialize, userMessage('hi')]);

		expect(readTrace(dir)[0].initialize).toEqual(initialize.request);
	});

	it('takes the schema from the initialize request when no flag is given', () => {
		const schema = {
			type: 'object',
			properties: { title: { type: 'string' } }
		};
		const init = {
			...initialize,
			request: { subtype: 'initialize', jsonSchema: schema }
		};

		const { result } = run([init, userMessage('hi')]);

		expect(result?.structured_output).toEqual(sampleFromSchema(schema));
	});

	it('fails loudly when replies.json is not valid JSON', () => {
		fs.writeFileSync(path.join(dir, 'replies.json'), '[{"text":');

		const res = spawnSync(process.execPath, [fakeClaude], {
			input: `${JSON.stringify(userMessage('hi'))}\n`,
			encoding: 'utf8',
			timeout: 10000,
			env: { ...process.env, FAKE_CLAUDE_DIR: dir }
		});

		expect(res.status).not.toBe(0);
		expect(res.stderr).toContain('replies.json');
	});

	it('gives parallel calls distinct numbers and distinct canned replies', () => {
		const count = 20;
		fs.writeFileSync(
			path.join(dir, 'replies.json'),
			JSON.stringify(
				Array.from({ length: count }, (_, i) => ({ text: `r${i}` }))
			)
		);
		fs.writeFileSync(
			path.join(dir, 'input.jsonl'),
			`${JSON.stringify(userMessage('hi'))}\n`
		);
		const script = Array.from(
			{ length: count },
			(_, i) =>
				`"${process.execPath}" "${fakeClaude}" < "${dir}/input.jsonl" > "${dir}/out-${i}.jsonl" &`
		).join('\n');

		spawnSync('sh', ['-c', `${script}\nwait`], {
			env: { ...process.env, FAKE_CLAUDE_DIR: dir },
			timeout: 20000
		});

		const answers = Array.from({ length: count }, (_, i) =>
			fs.readFileSync(path.join(dir, `out-${i}.jsonl`), 'utf8')
		).map(
			(out) =>
				JSON.parse(out.split('\n').filter(Boolean).at(-1) as string).result
		);
		expect([...answers].sort()).toEqual(
			Array.from({ length: count }, (_, i) => `r${i}`).sort()
		);
		expect(readTrace(dir).map((t) => t.n)).toEqual(
			Array.from({ length: count }, (_, i) => i)
		);
	});
});

describe('sampleFromSchema', () => {
	it('fills every property of an object, required or not', () => {
		const value = sampleFromSchema({
			type: 'object',
			properties: { a: { type: 'string' }, b: { type: 'boolean' } },
			required: ['a']
		});

		expect(value).toEqual({ a: expect.any(String), b: true });
	});

	it('makes strings long enough for rules the schema does not carry', () => {
		const value = sampleFromSchema({ type: 'string' }) as string;

		expect(value.length).toBeGreaterThanOrEqual(60);
	});

	it('respects a larger minLength', () => {
		const value = sampleFromSchema({
			type: 'string',
			minLength: 100
		}) as string;

		expect(value.length).toBeGreaterThanOrEqual(100);
	});

	it('uses the first enum value and const', () => {
		expect(sampleFromSchema({ enum: ['pending', 'done'] })).toBe('pending');
		expect(sampleFromSchema({ const: 'fixed' })).toBe('fixed');
	});

	it('makes arrays with at least one item, or minItems', () => {
		const item = { type: 'integer' };

		expect(sampleFromSchema({ type: 'array', items: item })).toEqual([1]);
		expect(
			sampleFromSchema({ type: 'array', items: item, minItems: 3 })
		).toEqual([1, 1, 1]);
	});

	it('uses minimum for numbers, falling back to 1', () => {
		expect(sampleFromSchema({ type: 'integer', minimum: 5 })).toBe(5);
		expect(sampleFromSchema({ type: 'number' })).toBe(1);
	});

	it('takes the first non-null branch of anyOf and nullable types', () => {
		expect(
			sampleFromSchema({ anyOf: [{ type: 'null' }, { type: 'integer' }] })
		).toBe(1);
		expect(sampleFromSchema({ type: ['null', 'boolean'] })).toBe(true);
	});

	it('returns an ISO date for date-time strings', () => {
		const value = sampleFromSchema({ type: 'string', format: 'date-time' });

		expect(value).toBe('2026-01-01T00:00:00.000Z');
	});

	it('returns null for a schema it cannot read', () => {
		expect(sampleFromSchema(undefined)).toBeNull();
		expect(sampleFromSchema({ $ref: '#/definitions/x' })).toBeNull();
	});
	it('leaves dependencies empty and keeps free-text status pending', () => {
		const value = sampleFromSchema({
			type: 'object',
			properties: {
				dependencies: { type: 'array', items: { type: 'integer' } },
				status: { type: 'string' }
			}
		});

		expect(value).toEqual({ dependencies: [], status: 'pending' });
	});

	it('numbers the ids of array items from 1', () => {
		const value = sampleFromSchema({
			type: 'array',
			minItems: 3,
			items: { type: 'object', properties: { id: { type: 'integer' } } }
		});

		expect(value).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
	});

	it('keeps a string within maxLength', () => {
		const value = sampleFromSchema({ type: 'string', maxLength: 10 }) as string;

		expect(value).toHaveLength(10);
	});
});

describe('installFakeClaude', () => {
	let project: string;
	let work: string;

	beforeEach(() => {
		project = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-claude-proj-'));
		work = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-claude-work-'));
		fs.mkdirSync(path.join(project, '.taskgraph'));
		fs.writeFileSync(
			path.join(project, '.taskgraph', 'config.json'),
			JSON.stringify({ global: { logLevel: 'info' }, claudeCode: { x: 1 } })
		);
	});

	afterEach(() => {
		fs.rmSync(project, { recursive: true, force: true });
		fs.rmSync(work, { recursive: true, force: true });
	});

	it('writes an executable shim named claude outside the project', () => {
		const { executable } = installFakeClaude({
			projectDir: project,
			workDir: work
		});

		expect(path.basename(executable)).toBe(
			process.platform === 'win32' ? 'claude.exe' : 'claude'
		);
		expect(path.isAbsolute(executable)).toBe(true);
		expect(path.relative(project, executable).startsWith('..')).toBe(true);
		// Windows has no execute bit
		if (process.platform !== 'win32') {
			expect(fs.statSync(executable).mode & 0o111).not.toBe(0);
		}
	});

	it('points the project config at the shim and keeps other settings', () => {
		const { executable } = installFakeClaude({
			projectDir: project,
			workDir: work
		});

		const config = JSON.parse(
			fs.readFileSync(path.join(project, '.taskgraph', 'config.json'), 'utf8')
		);
		expect(config.claudeCode).toEqual({
			x: 1,
			pathToClaudeCodeExecutable: executable
		});
		expect(config.global).toEqual({ logLevel: 'info' });
	});

	it('returns the env the CLI needs and a shim that runs the fake', () => {
		const {
			executable,
			env,
			dir: fakeDir
		} = installFakeClaude({
			projectDir: project,
			workDir: work
		});

		const res = spawnSync(executable, [], {
			input: `${JSON.stringify(userMessage('via shim'))}\n`,
			encoding: 'utf8',
			timeout: 10000,
			env: { ...process.env, ...env }
		});

		expect(res.status).toBe(0);
		expect(res.stdout).toContain('"type":"result"');
		expect(readTrace(fakeDir)[0].prompt).toBe('via shim');
	});

	it('writes canned replies when given', () => {
		const { dir: fakeDir } = installFakeClaude({
			projectDir: project,
			workDir: work,
			replies: [{ text: 'canned' }]
		});

		expect(
			JSON.parse(fs.readFileSync(path.join(fakeDir, 'replies.json'), 'utf8'))
		).toEqual([{ text: 'canned' }]);
	});
	it('clears the trace of an earlier install in the same work dir', () => {
		const first = installFakeClaude({ projectDir: project, workDir: work });
		spawnSync(first.executable, [], {
			input: `${JSON.stringify(userMessage('old'))}\n`,
			env: { ...process.env, ...first.env },
			timeout: 10000
		});
		expect(readTrace(first.dir)).toHaveLength(1);

		const second = installFakeClaude({ projectDir: project, workDir: work });

		expect(readTrace(second.dir)).toEqual([]);
	});

	it('skips a trace line the fake is still appending (#712)', () => {
		const { dir: fakeDir } = installFakeClaude({
			projectDir: project,
			workDir: work
		});
		const line = JSON.stringify({ n: 0, prompt: 'x'.repeat(10000) });
		fs.writeFileSync(
			path.join(fakeDir, 'trace.jsonl'),
			`${line}\n${line.slice(0, 8192)}`
		);

		expect(readTrace(fakeDir).map((t) => t.n)).toEqual([0]);
	});

	it('keeps real credentials and the real Claude config out of the env', () => {
		const { env } = installFakeClaude({ projectDir: project, workDir: work });

		expect(env.ANTHROPIC_API_KEY).toBe('');
		expect(env.CLAUDE_CODE_API_KEY).toBe('');
		expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('');
		expect(path.relative(work, env.CLAUDE_CONFIG_DIR).startsWith('..')).toBe(
			false
		);
	});

	it('names the missing file when the project has no config', () => {
		fs.rmSync(path.join(project, '.taskgraph', 'config.json'));

		expect(() =>
			installFakeClaude({ projectDir: project, workDir: work })
		).toThrow(/config\.json.*taskgraph init/s);
	});

	it('leaves no temporary files behind', () => {
		const { dir: fakeDir } = installFakeClaude({
			projectDir: project,
			workDir: work,
			replies: [{ text: 'x' }]
		});

		expect(fs.readdirSync(fakeDir).sort()).toEqual(['replies.json']);
		expect(fs.readdirSync(path.join(project, '.taskgraph')).sort()).toEqual([
			'config.json'
		]);
	});
});
