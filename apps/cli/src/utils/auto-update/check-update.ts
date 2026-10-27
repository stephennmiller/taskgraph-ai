/**
 * @fileoverview Check npm registry for package updates with caching
 *
 * Uses a simple file-based cache under `~/.taskgraph` to avoid
 * hitting npm on every CLI invocation. Cache expires after 1 hour.
 */

import fs from 'node:fs';
import https from 'https';
import path from 'node:path';

import { PACKAGE_NAME } from './constants.js';

import { SEMVER_RE, fetchChangelogHighlights } from './changelog.js';
import { resolveHome } from './policy.js';
import type { UpdateInfo } from './types.js';
import { compareVersions, getCurrentVersion } from './version.js';

// ============================================================================
// Cache Configuration
// ============================================================================

/** Cache TTL: 1 hour in milliseconds */
const CACHE_TTL_MS = 60 * 60 * 1000;

/** Cache file name, beside `update.lock` */
const CACHE_FILENAME = 'update-cache.json';

interface UpdateCache {
	timestamp: number;
	latestVersion: string;
	highlights?: string[];
}

// ============================================================================
// Cache Operations (Single Responsibility: cache I/O)
// ============================================================================

/** The update cache file under `~/.taskgraph`; throws without a home */
function getCachePath(): string {
	const home = resolveHome();
	if (!home) throw new Error('no home directory');
	return path.join(home, '.taskgraph', CACHE_FILENAME);
}

/**
 * Read cached update info if still valid. The file is only as trusted as
 * the home directory: a non-semver version, a timestamp in the future or
 * an expired one all count as no cache.
 * @internal - Exported for testing purposes only
 * @returns Cached data or null if expired/missing/invalid
 */
export function readCache(): UpdateCache | null {
	try {
		const data = JSON.parse(
			fs.readFileSync(getCachePath(), 'utf-8')
		) as Partial<UpdateCache>;
		if (
			typeof data.timestamp !== 'number' ||
			typeof data.latestVersion !== 'string' ||
			!SEMVER_RE.test(data.latestVersion)
		) {
			return null;
		}
		const age = Date.now() - data.timestamp;
		if (age < 0 || age > CACHE_TTL_MS) return null;
		return {
			timestamp: data.timestamp,
			latestVersion: data.latestVersion,
			highlights: Array.isArray(data.highlights)
				? data.highlights.filter((h) => typeof h === 'string')
				: undefined
		};
	} catch {
		return null;
	}
}

/**
 * Write update info to cache
 * @internal - Exported for testing purposes only
 */
export function writeCache(latestVersion: string, highlights?: string[]): void {
	try {
		const cachePath = getCachePath();
		fs.mkdirSync(path.dirname(cachePath), { recursive: true });
		fs.writeFileSync(
			cachePath,
			JSON.stringify(
				{
					timestamp: Date.now(),
					latestVersion,
					highlights
				} satisfies UpdateCache,
				null,
				2
			)
		);
	} catch {
		// Cache write failures are non-critical - silently ignore
	}
}

// ============================================================================
// NPM Registry Operations (Single Responsibility: npm API)
// ============================================================================

/** Request timeout for npm registry */
const NPM_TIMEOUT_MS = 3000;

/**
 * Fetch latest version from npm registry
 * @returns Latest version string or null on failure
 */
function fetchLatestVersion(currentVersion: string): Promise<string | null> {
	return new Promise((resolve) => {
		const req = https.request(
			{
				hostname: 'registry.npmjs.org',
				path: `/${PACKAGE_NAME}`,
				method: 'GET',
				headers: {
					Accept: 'application/vnd.npm.install-v1+json',
					'User-Agent': `${PACKAGE_NAME}/${currentVersion}`
				}
			},
			(res) => {
				let data = '';
				res.on('data', (chunk) => (data += chunk));
				res.on('end', () => {
					try {
						if (res.statusCode !== 200) {
							resolve(null);
							return;
						}
						const npmData = JSON.parse(data);
						resolve(npmData['dist-tags']?.latest || null);
					} catch {
						resolve(null);
					}
				});
			}
		);

		req.on('error', () => resolve(null));
		req.setTimeout(NPM_TIMEOUT_MS, () => {
			req.destroy();
			resolve(null);
		});
		req.end();
	});
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Build UpdateInfo response
 */
function buildUpdateInfo(
	currentVersion: string,
	latestVersion: string,
	highlights?: string[]
): UpdateInfo {
	return {
		currentVersion,
		latestVersion,
		needsUpdate: compareVersions(currentVersion, latestVersion) < 0,
		highlights
	};
}

/**
 * Check for newer version of taskgraph-ai
 * Uses a 1-hour cache to avoid hitting npm on every CLI invocation
 */
export async function checkForUpdate(
	currentVersionOverride?: string
): Promise<UpdateInfo> {
	const currentVersion = currentVersionOverride || getCurrentVersion();

	// Return cached result if valid
	const cached = readCache();
	if (cached) {
		return buildUpdateInfo(
			currentVersion,
			cached.latestVersion,
			cached.highlights
		);
	}

	// Fetch from npm registry
	const latestVersion = await fetchLatestVersion(currentVersion);
	if (!latestVersion) {
		return buildUpdateInfo(currentVersion, currentVersion);
	}

	// Fetch changelog highlights if update available
	const needsUpdate = compareVersions(currentVersion, latestVersion) < 0;
	const highlights = needsUpdate
		? await fetchChangelogHighlights(latestVersion)
		: undefined;

	// Cache result
	writeCache(latestVersion, highlights);

	return buildUpdateInfo(currentVersion, latestVersion, highlights);
}
