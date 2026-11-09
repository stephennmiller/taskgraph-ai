/**
 * Reads the code out of a Markdown or MDX page, for the tests that check
 * what the docs show against the CLI (taskgraph-claude-md-drift.test.ts,
 * docs-examples.test.ts).
 */

interface CodeLine {
	text: string;
	/** 1-based line in the page */
	line: number;
	/** The fence's language (`''` for a bare fence); undefined for an inline span */
	lang?: string;
}

/** Each line inside a fenced block and each inline backtick span */
function codeLines(markdown: string): CodeLine[] {
	const found: CodeLine[] = [];
	let lang: string | undefined;
	markdown.split('\n').forEach((text, i) => {
		const fence = text.trimStart().match(/^```(\S*)/);
		if (fence) {
			lang = lang === undefined ? fence[1] : undefined;
		} else if (lang !== undefined) {
			found.push({ text, line: i + 1, lang });
		} else {
			for (const m of text.matchAll(/`([^`]+)`/g)) {
				found.push({ text: m[1], line: i + 1 });
			}
		}
	});
	return found;
}

/** Text inside fenced blocks and inline backticks, one entry per span/line. */
export function codeSpans(markdown: string): string[] {
	return codeLines(markdown).map(({ text }) => text);
}

// Strip a trailing `# note`, but keep `// = taskgraph <cmd>` (it names a command)
export const stripComment = (s: string) =>
	s.replace(/\s+#.*$/, '').replace(/\s+\/\/(?!\s*=\s*taskgraph\b).*$/, '');

/** The command lines in a page's ```bash blocks, without comments and blank lines */
export function bashExamples(markdown: string): CodeLine[] {
	return codeLines(markdown)
		.filter(({ lang, text }) => lang === 'bash' && !/^\s*(#|$)/.test(text))
		.map((code) => ({ ...code, text: stripComment(code.text).trim() }));
}
