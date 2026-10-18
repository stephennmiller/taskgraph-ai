/**
 * The plugin must not ship an MCP server registration or advertise one.
 * taskgraph-ai is not published to npm, so any `npx -y taskgraph-ai` server
 * the plugin registered could never start. The tools come from the server the
 * user adds themselves (see the README).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const pluginDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../../packages/claude-code-plugin'
);
const readJson = (relPath) =>
	JSON.parse(fs.readFileSync(path.join(pluginDir, relPath), 'utf8'));

describe('claude code plugin MCP registration', () => {
	test('does not ship an .mcp.json or mcp.json', () => {
		expect(fs.existsSync(path.join(pluginDir, '.mcp.json'))).toBe(false);
		expect(fs.existsSync(path.join(pluginDir, 'mcp.json'))).toBe(false);
	});

	test('plugin.json does not declare mcpServers', () => {
		expect(readJson('.claude-plugin/plugin.json').mcpServers).toBeUndefined();
	});

	test.each(['.claude-plugin/plugin.json', 'package.json'])(
		'%s does not advertise MCP integration',
		(file) => {
			const meta = readJson(file);
			expect(meta.description).not.toMatch(/mcp/i);
			expect(meta.keywords ?? []).not.toContain('mcp');
		}
	);
});
