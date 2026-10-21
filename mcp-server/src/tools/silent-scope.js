/**
 * silent-scope.js
 * Gives each MCP tool call its own silent-mode switch.
 */

import { withSilentScope } from '../../../scripts/modules/utils.js';

/**
 * Wrap a server so every tool it registers runs each call in its own silent
 * scope. Tools turn silent mode on and off around their work; without a scope
 * that switch is shared, so one call finishing would un-silence a slower one
 * and let its logs corrupt the stdio stream.
 * @param {Object} server - FastMCP server
 * @returns {Object} A server whose addTool scopes each call
 */
export function scopeToolExecution(server) {
	return new Proxy(server, {
		get(target, prop) {
			if (prop === 'addTool') {
				return (tool) =>
					target.addTool({
						...tool,
						execute: (...args) => withSilentScope(() => tool.execute(...args))
					});
			}
			const value = target[prop];
			return typeof value === 'function' ? value.bind(target) : value;
		}
	});
}
