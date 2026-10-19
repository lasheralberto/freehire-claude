#!/usr/bin/env node
// stdio entry point: `node mcp/src/index.js` (Claude Code, Claude Desktop, or the web bridge).

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

const server = createServer();
await server.connect(new StdioServerTransport());
console.error('[freehire-mcp] ready on stdio');
