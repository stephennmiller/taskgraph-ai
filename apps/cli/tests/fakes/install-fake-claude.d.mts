export interface FakeClaudeInstall {
	/** Absolute path of the `claude` shim */
	executable: string;
	/** Directory holding trace.jsonl and replies.json */
	dir: string;
	/** Environment variables the CLI or MCP server process needs */
	env: Record<string, string>;
}

export interface TraceEntry {
	n: number;
	args: string[];
	schema: any;
	prompt: string;
	/** The initialize control request the SDK sent, if any */
	initialize: any;
}

export function installFakeClaude(options: {
	projectDir: string;
	workDir: string;
	replies?: object[];
}): FakeClaudeInstall;

export function readTrace(dir: string): TraceEntry[];
