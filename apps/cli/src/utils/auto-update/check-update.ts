/**
 * @fileoverview Check npm registry for package updates with caching
 *
 * Uses a simple file-based cache under `~/.taskgraph` to avoid
 * hitting npm on every CLI invocation. Cache expires after 1 hour, or
 * after 10 minutes when the registry couldn't be reached.
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

/** A failed check is retried after 10 minutes, so a dead network slows one command, not every one */
const FAILED_CHECK_TTL_MS = 10 * 60 * 1000;

/** Cache file name, beside `update.lock` */
const CACHE_FILENAME = 'update-cache.json';

interface UpdateCache {
	timestamp: number;
	latestVersion: string;
	highlights?: string[];
	/** The registry couldn't be reached; latestVersion is the version that ran */
	failed?: boolean;
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
		const ttl = data.failed === true ? FAILED_CHECK_TTL_MS : CACHE_TTL_MS;
		if (age < 0 || age > ttl) return null;
		return {
			timestamp: data.timestamp,
			latestVersion: data.latestVersion,
			highlights: Array.isArray(data.highlights)
				? data.highlights.filter((h) => typeof h === 'string')
				: undefined,
			failed: data.failed === true || undefined
		};
	} catch {
		return null;
	}
}

/**
 * Write update info to cache
 * @internal - Exported for testing purposes only
 */
export function writeCache(
	latestVersion: string,
	highlights?: string[],
	failed?: boolean
): void {
	try {
		const cachePath = getCachePath();
		fs.mkdirSync(path.dirname(cachePath), { recursive: true });
		fs.writeFileSync(
			cachePath,
			JSON.stringify(
				{
					timestamp: Date.now(),
					latestVersion,
					highlights,
					failed
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

/** Deadline for the whole npm registry request, connecting included */
const NPM_TIMEOUT_MS = 3000;

/**
 * Fetch latest version from npm registry
 * @returns Latest version string, or null on failure or a non-semver reply
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
				},
				// req.setTimeout starts only once connected, so a blackholed host would hang
				signal: AbortSignal.timeout(NPM_TIMEOUT_MS)
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
						const latest = JSON.parse(data)['dist-tags']?.latest;
						resolve(
							typeof latest === 'string' && SEMVER_RE.test(latest)
								? latest
								: null
						);
					} catch {
						resolve(null);
					}
				});
			}
		);

		req.on('error', () => resolve(null));
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
 * Uses a 1-hour cache to avoid hitting npm on every CLI invocation, and
 * a 10-minute one after a failed check. `fresh` skips the cache, for an
 * explicit `taskgraph upgrade`.
 */
export async function checkForUpdate(
	currentVersionOverride?: string,
	{ fresh = false }: { fresh?: boolean } = {}
): Promise<UpdateInfo> {
	const currentVersion = currentVersionOverride || getCurrentVersion();

	// Return cached result if valid
	const cached = fresh ? null : readCache();
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
		// A fresh check that fails keeps a good entry, so later commands still see its version
		const kept = fresh ? readCache() : null;
		if (!kept || kept.failed) writeCache(currentVersion, undefined, true);
		return { ...buildUpdateInfo(currentVersion, currentVersion), failed: true };
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
