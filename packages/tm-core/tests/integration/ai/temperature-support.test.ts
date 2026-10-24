/**
 * Integration Tests for Provider Temperature Support
 *
 * Claude Code runs through the local CLI, which does not accept a temperature
 * parameter, so the provider must declare supportsTemperature = false.
 *
 * Kept apart from the unit tests so base provider tests do not depend on a
 * concrete provider implementation.
 */

import { describe, expect, it } from 'vitest';
import { ClaudeCodeProvider } from '../../../src/index.js';
import { providerOptions } from './provider-options.js';

describe('Provider Temperature Support', () => {
	it('should verify Claude Code has supportsTemperature = false', () => {
		expect(new ClaudeCodeProvider(providerOptions()).supportsTemperature).toBe(
			false
		);
	});
});
