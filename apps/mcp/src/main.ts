#!/usr/bin/env node
/**
 * @fileoverview The published MCP server entry, built to dist/mcp-server.js
 * (the taskgraph-mcp and taskgraph-ai bins).
 */

import { startServer } from './server.js';

// Silences tm-core's console output, which would corrupt the stdio stream
process.env.TASKGRAPH_MCP = 'true';

startServer();
