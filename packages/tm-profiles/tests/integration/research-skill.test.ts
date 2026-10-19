import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const pluginRoot = join(
	dirname(fileURLToPath(import.meta.url)),
	'../../../claude-code-plugin'
);
const skillPath = join(pluginRoot, 'skills/research/SKILL.md');

function parseFrontmatter(source: string): {
	data: Record<string, string>;
	body: string;
} {
	const match = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
	if (!match) throw new Error('SKILL.md has no frontmatter');
	const data: Record<string, string> = {};
	for (const line of match[1].split('\n')) {
		const idx = line.indexOf(':');
		if (idx > 0) data[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
	}
	return { data, body: match[2] };
}

describe('plugin research skill', () => {
	const { data, body } = parseFrontmatter(readFileSync(skillPath, 'utf-8'));
	const allowed = (data['allowed-tools'] ?? '').split(/[\s,]+/).filter(Boolean);

	it('is named after its directory and has a trigger description', () => {
		expect(data.name).toBe('research');
		expect(data.description.length).toBeGreaterThan(40);
	});

	it('uses WebSearch and WebFetch for research', () => {
		expect(allowed).toContain('WebSearch');
		expect(allowed).toContain('WebFetch');
	});

	it('does not grant file-write or shell tools', () => {
		for (const tool of ['Bash', 'Write', 'Edit']) {
			expect(allowed).not.toContain(tool);
		}
	});

	it('treats Context7 as optional and falls back to web tools', () => {
		expect(body).toMatch(/Context7/);
		expect(body).toMatch(/optional/i);
		expect(body).toMatch(/not (installed|available|enabled)|absent/i);
	});

	it('needs no API key', () => {
		expect(body).not.toMatch(/PERPLEXITY|_API_KEY/);
	});

	it('relies on skills/ auto-discovery: the manifest sets no custom skills path', () => {
		const manifest = JSON.parse(
			readFileSync(join(pluginRoot, '.claude-plugin/plugin.json'), 'utf-8')
		);
		expect(manifest.name).toBe('taskgraph');
		expect(manifest.skills).toBeUndefined();
	});
});
