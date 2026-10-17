/**
 * @fileoverview Unit tests for profile utility functions
 *
 * Tests the profile lookup functions exported from index.ts:
 * - getProfile(name) - returns profile by name (case-insensitive)
 * - getAllProfiles() - returns array of all profile instances
 * - getProfileNames() - returns array of profile names
 */

import { describe, expect, it } from 'vitest';
import {
	BaseSlashCommandProfile,
	ClaudeProfile,
	getAllProfiles,
	getProfile,
	getProfileNames
} from './index.js';

describe('Profile Utility Functions', () => {
	describe('getProfile', () => {
		it('returns ClaudeProfile for "claude"', () => {
			const profile = getProfile('claude');

			expect(profile).toBeInstanceOf(ClaudeProfile);
			expect(profile?.name).toBe('claude');
			expect(profile?.displayName).toBe('Claude Code');
		});

		it.each(['CLAUDE', 'Claude', 'cLaUdE'])(
			'is case insensitive for "%s"',
			(name) => {
				expect(getProfile(name)).toBeInstanceOf(ClaudeProfile);
			}
		);

		it.each(['cursor', 'roo', 'gemini', 'codex', 'opencode', '', 'claud'])(
			'returns undefined for unsupported profile "%s"',
			(name) => {
				expect(getProfile(name)).toBeUndefined();
			}
		);

		it('returns the same instance for repeated calls', () => {
			expect(getProfile('claude')).toBe(getProfile('claude'));
		});
	});

	describe('getAllProfiles', () => {
		it('contains only the Claude profile', () => {
			const profiles = getAllProfiles();

			expect(profiles).toHaveLength(1);
			expect(profiles[0]).toBeInstanceOf(ClaudeProfile);
			expect(profiles[0]).toBeInstanceOf(BaseSlashCommandProfile);
		});

		it('returns a new array on each call (defensive copy)', () => {
			expect(getAllProfiles()).not.toBe(getAllProfiles());
		});

		it('exposes required properties and supports commands', () => {
			const [profile] = getAllProfiles();

			expect(profile.name).toBeTruthy();
			expect(profile.displayName).toBeTruthy();
			expect(profile.commandsDir).toBeTruthy();
			expect(profile.supportsCommands).toBe(true);
		});
	});

	describe('getProfileNames', () => {
		it('returns only "claude"', () => {
			expect(getProfileNames()).toEqual(['claude']);
		});
	});
});
