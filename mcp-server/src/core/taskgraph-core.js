/**
 * taskgraph-core.js
 * Central module that imports and re-exports all direct function implementations
 * for improved organization and maintainability.
 */

// Import direct function implementations
import { initializeProjectDirect } from './direct-functions/initialize-project.js';
import { modelsDirect } from './direct-functions/models.js';
import { parsePRDDirect } from './direct-functions/parse-prd.js';

// Re-export all direct function implementations
export { parsePRDDirect, initializeProjectDirect, modelsDirect };
