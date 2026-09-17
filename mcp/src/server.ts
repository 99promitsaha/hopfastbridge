/**
 * HopFast MCP Server
 *
 * Assembles all tools, resources, and prompts into a single McpServer instance.
 * Keeping this separate from index.ts lets us support multiple transports.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerSwapTools } from './tools/swap.js';
import { registerEarnTools } from './tools/earn.js';
import { registerWalletTools } from './tools/wallet.js';
import { registerResources } from './resources/index.js';
import { registerPrompts } from './prompts/index.js';

export function createHopFastMcpServer(): McpServer {
  const server = new McpServer({
    name: 'hopfast',
    version: '0.1.0',
  });

  // Register all capabilities
  registerSwapTools(server);
  registerEarnTools(server);
  registerWalletTools(server);
  registerResources(server);
  registerPrompts(server);

  return server;
}
