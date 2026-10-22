#!/usr/bin/env node
/**
 * A stand-in for the Claude Code executable, so the built CLI and MCP server
 * can run AI commands without a real model.
 *
 * ai-sdk-provider-claude-code starts `claude` with stream-json on stdin and
 * stdout: it sends an `initialize` control request, then the user message, and
 * reads system, assistant and result messages back. This program answers the
 * first and replies to the second, once, then exits.
 *
 * The reply is built from the schema (the `--json-schema` flag, or the
 * `jsonSchema` of the initialize request) when there is one, or is plain
 * text. With FAKE_CLAUDE_DIR set it also
 *   - appends every call to <dir>/trace.jsonl as {n, args, schema, prompt,
 *     initialize}; calls are numbered by claiming <dir>/call-<n>, so parallel
 *     calls get different numbers
 *   - takes call n's reply from <dir>/replies.json when that file has one:
 *     an array of {object}, {text} or {error}; later calls are generated.
 *     An {object} is sent as given, so it must include every field the
 *     command's schema requires (see `required` in the trace).
 *     Any entry can also carry {holdUntil: "<name>"}: the call is traced at
 *     once but answers only after <dir>/<name> exists, so a test can change
 *     tasks.json while an AI command waits on the model.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { sampleFromSchema } from './schema-sample.mjs';

const args = process.argv.slice(2);
const flagIndex = args.indexOf('--json-schema');
let schema = flagIndex >= 0 ? JSON.parse(args[flagIndex + 1]) : null;
let initializeRequest = null;
const dir = process.env.FAKE_CLAUDE_DIR || null;
const sessionId = 'fake-session';

const send = (message, then) =>
	process.stdout.write(`${JSON.stringify(message)}\n`, then);

/** Take the lowest call number nobody else has taken. */
function claimCall() {
	if (!dir) return 0;
	fs.mkdirSync(dir, { recursive: true });
	for (let n = 0; ; n++) {
		try {
			fs.closeSync(fs.openSync(path.join(dir, `call-${n}`), 'wx'));
			return n;
		} catch (error) {
			if (error.code !== 'EEXIST') throw error;
		}
	}
}

function cannedReply(n) {
	if (!dir) return undefined;
	let text;
	try {
		text = fs.readFileSync(path.join(dir, 'replies.json'), 'utf8');
	} catch (error) {
		if (error.code === 'ENOENT') return undefined;
		throw error;
	}
	try {
		return JSON.parse(text)[n];
	} catch (error) {
		process.stderr.write(`fake claude: bad replies.json: ${error.message}\n`);
		process.exit(1);
	}
}

const HOLD_LIMIT_MS = 120000;

/** Wait until <dir>/<name> exists; fail the call if it never appears. */
function holdUntil(name, then) {
	const file = path.join(dir, name);
	const started = Date.now();
	const poll = () => {
		if (fs.existsSync(file)) return then();
		if (Date.now() - started > HOLD_LIMIT_MS) {
			process.stderr.write(`fake claude: ${file} never appeared\n`);
			process.exit(1);
		}
		setTimeout(poll, 20);
	};
	poll();
}

function promptOf(message) {
	const { content } = message.message ?? {};
	if (typeof content === 'string') return content;
	return (content ?? []).map((part) => part.text ?? '').join('');
}

const usage = {
	input_tokens: 1,
	output_tokens: 1,
	cache_creation_input_tokens: 0,
	cache_read_input_tokens: 0
};

function reply(userMessage) {
	const n = claimCall();
	if (dir) {
		fs.appendFileSync(
			path.join(dir, 'trace.jsonl'),
			`${JSON.stringify({
				n,
				args,
				schema,
				prompt: promptOf(userMessage),
				initialize: initializeRequest
			})}\n`
		);
	}

	const canned = cannedReply(n);
	if (canned?.holdUntil !== undefined) {
		holdUntil(String(canned.holdUntil), () => answer(canned));
	} else {
		answer(canned);
	}
}

function answer(canned) {
	let structured;
	let text;
	let error;
	if (canned?.error !== undefined) error = String(canned.error);
	else if (canned?.object !== undefined) structured = canned.object;
	else if (canned?.text !== undefined) text = String(canned.text);
	else if (schema) structured = sampleFromSchema(schema);
	else text = 'Sample text answer';

	const answerText =
		structured !== undefined ? JSON.stringify(structured) : text;
	const base = {
		session_id: sessionId,
		duration_ms: 1,
		duration_api_ms: 1,
		num_turns: 1,
		total_cost_usd: 0,
		usage
	};

	send({
		type: 'system',
		subtype: 'init',
		session_id: sessionId,
		model: 'fake',
		tools: [],
		cwd: process.cwd()
	});
	if (error !== undefined) {
		send(
			{
				type: 'result',
				subtype: 'error_during_execution',
				is_error: true,
				result: error,
				// the SDK calls errors.map(...) on every non-success result
				errors: [error],
				...base
			},
			() => process.exit(0)
		);
		return;
	}
	send({
		type: 'assistant',
		session_id: sessionId,
		message: {
			role: 'assistant',
			content: [{ type: 'text', text: answerText }],
			usage: { input_tokens: 1, output_tokens: 1 }
		}
	});
	send(
		{
			type: 'result',
			subtype: 'success',
			is_error: false,
			result: answerText,
			...(structured !== undefined ? { structured_output: structured } : {}),
			...base
		},
		() => process.exit(0)
	);
}

createInterface({ input: process.stdin }).on('line', (line) => {
	const message = JSON.parse(line);
	if (message.type === 'control_request') {
		initializeRequest = message.request ?? null;
		if (!schema && initializeRequest?.jsonSchema) {
			schema = initializeRequest.jsonSchema;
		}
		send({
			type: 'control_response',
			response: {
				subtype: 'success',
				request_id: message.request_id,
				response: {}
			}
		});
	} else if (message.type === 'user') {
		reply(message);
	}
});
