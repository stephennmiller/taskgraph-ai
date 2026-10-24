#!/usr/bin/env node
/**
 * @fileoverview The published MCP server entry, built to dist/mcp-server.js
 * (the taskgraph-mcp and taskgraph-ai bins).
 */

// Silences tm-core's console output, which would corrupt the stdio stream.
// Set before any import runs: modules build loggers at load time (#612).
process.env.TASKGRAPH_MCP = 'true';

const { startServer } = await import('./server.js');
startServer();

// Marks the file as a module, which top-level await needs
export {};
