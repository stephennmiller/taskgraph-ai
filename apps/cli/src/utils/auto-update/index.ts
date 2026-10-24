/**
 * @fileoverview Auto-update utilities for taskgraph-ai CLI
 *
 * This module provides functionality for:
 * - Checking for updates from npm registry
 * - Installing updates through npm
 * - Displaying update notifications
 * - Restarting CLI after updates
 */

// Re-export version utilities
export { compareVersions } from './version.js';

// Re-export update checking
export { checkForUpdate } from './check-update.js';

// Re-export display utilities
export { displayUpgradeNotification } from './display.js';

// Re-export installation
export { performAutoUpdate } from './install.js';

// Re-export restart functionality
export { restartWithNewVersion } from './restart.js';
