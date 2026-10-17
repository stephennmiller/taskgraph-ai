import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	detectInstalledIDEs,
	detectProfile,
	getPreSelectedProfiles
} from './detector.js';
import { IDE_MARKERS } from './profiles-map.js';

// Use real fs operations with temp directories for accurate testing
describe('IDE Detection', () => {
	let tempDir: string;

	beforeEach(() => {
		// Create a real temp directory for each test
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-detection-test-'));
	});

	afterEach(() => {
		// Clean up temp directory
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	describe('detectInstalledIDEs', () => {
		it('should detect the .claude directory', () => {
			// Arrange
			fs.mkdirSync(path.join(tempDir, '.claude'));

			// Act
			const results = detectInstalledIDEs({ projectRoot: tempDir });

			// Assert
			expect(results).toEqual([
				{
					profileName: 'claude',
					markerPath: '.claude',
					displayName: 'Claude Code',
					exists: true
				}
			]);
		});

		it('should return empty array when nothing is detected', () => {
			const results = detectInstalledIDEs({ projectRoot: tempDir });

			expect(results).toHaveLength(0);
		});

		it.each(['.cursor', '.windsurf', '.roo', '.vscode', '.gemini', '.codex'])(
			'should ignore the non-Claude marker %s',
			(marker) => {
				fs.mkdirSync(path.join(tempDir, marker));

				const results = detectInstalledIDEs({ projectRoot: tempDir });

				expect(results).toHaveLength(0);
			}
		);

		it('should not detect a file named .claude as a directory', () => {
			fs.writeFileSync(path.join(tempDir, '.claude'), 'not a directory');

			const results = detectInstalledIDEs({ projectRoot: tempDir });

			expect(results).toHaveLength(0);
		});
	});

	describe('getPreSelectedProfiles', () => {
		it('should return profile names only', () => {
			fs.mkdirSync(path.join(tempDir, '.claude'));

			const profiles = getPreSelectedProfiles({ projectRoot: tempDir });

			expect(profiles).toEqual(['claude']);
		});

		it('should return empty array when no IDEs detected', () => {
			const profiles = getPreSelectedProfiles({ projectRoot: tempDir });

			expect(profiles).toEqual([]);
		});
	});

	describe('detectProfile', () => {
		it('should return detection result for existing profile', () => {
			fs.mkdirSync(path.join(tempDir, '.claude'));

			const result = detectProfile('claude', tempDir);

			expect(result).toEqual({
				profileName: 'claude',
				markerPath: '.claude',
				displayName: 'Claude Code',
				exists: true
			});
		});

		it('should return null when .claude does not exist', () => {
			expect(detectProfile('claude', tempDir)).toBeNull();
		});

		it('should return null for an unsupported profile', () => {
			fs.mkdirSync(path.join(tempDir, '.cursor'));

			expect(detectProfile('cursor', tempDir)).toBeNull();
		});
	});
});

describe('IDE_MARKERS', () => {
	it('should only define the claude profile', () => {
		expect(IDE_MARKERS.map((m) => m.profileName)).toEqual(['claude']);
	});

	it('should have valid marker definitions', () => {
		for (const marker of IDE_MARKERS) {
			expect(marker.displayName).toBeTruthy();
			expect(marker.markers.length).toBeGreaterThan(0);

			for (const m of marker.markers) {
				expect(m.path).toBeTruthy();
				expect(['directory', 'file']).toContain(m.type);
			}
		}
	});
});
