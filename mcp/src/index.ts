#!/usr/bin/env node
/**
 * HopFast MCP Server — Entry Point
 *
 * Supports two transport modes:
 *
 *   stdio  (default) — for Claude Desktop, Claude Code, and any MCP client
 *                       that spawns the server as a child process.
 *     npx hopfast-mcp
 *     node dist/index.js
 *
 *   http   — Streamable HTTP transport for remote / cloud agents.
 *             Agents connect to POST /mcp and GET /mcp (SSE).
 *     node dist/index.js --http [--port 3100]
 *
 * Environment variables:
 *   HOPFAST_API_URL   — HopFast backend URL (default: http://localhost:8080)
 *   PORT              — HTTP server port when using --http flag (default: 3100)
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from 'node:http';
import { createHopFastMcpServer } from './server.js';

const args = process.argv.slice(2);
const useHttp = args.includes('--http');
const portArg = args.find((a) => a.startsWith('--port='));
const HTTP_PORT = portArg
  ? Number(portArg.split('=')[1])
  : Number(process.env.PORT ?? 3100);

async function startStdio(): Promise<void> {
  const mcpServer = createHopFastMcpServer();
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  // Log to stderr so stdout stays clean for the MCP protocol
  process.stderr.write(
    '[HopFast MCP] Running on stdio transport. Ready.\n',
  );
}

async function startHttp(): Promise<void> {
  // Each HTTP request gets its own transport instance (stateless sessions)
  // Stateless: create a fresh server+transport per request.
  // This is correct for DeFi tools that are short-lived HTTP calls.
  // No sessions to track — agents send all context in each request.
  const httpServer = createServer(async (req, res) => {
    // CORS headers so browser-based agents can connect
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Mcp-Session-Id');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, server: 'hopfast-mcp', transport: 'http' }));
      return;
    }

    if (req.url !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found. MCP endpoint is POST /mcp');
      return;
    }

    const mcpServer = createHopFastMcpServer();
    // sessionIdGenerator: undefined = stateless (no session tracking)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    res.on('close', () => {
      transport.close().catch(() => {});
      mcpServer.close().catch(() => {});
    });

    await mcpServer.connect(transport);
    await transport.handleRequest(req, res);
  });

  httpServer.listen(HTTP_PORT, () => {
    console.log(
      `[HopFast MCP] HTTP transport listening on http://localhost:${HTTP_PORT}/mcp`,
    );
    console.log(`[HopFast MCP] Health check: http://localhost:${HTTP_PORT}/health`);
    console.log(
      `[HopFast MCP] Connecting to HopFast API: ${process.env.HOPFAST_API_URL ?? 'http://localhost:8080'}`,
    );
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n[HopFast MCP] Shutting down...');
    httpServer.close(() => process.exit(0));
  });
  process.on('SIGTERM', () => {
    httpServer.close(() => process.exit(0));
  });
}

if (useHttp) {
  startHttp().catch((err: unknown) => {
    console.error('[HopFast MCP] Fatal error:', err);
    process.exit(1);
  });
} else {
  startStdio().catch((err: unknown) => {
    process.stderr.write(`[HopFast MCP] Fatal error: ${String(err)}\n`);
    process.exit(1);
  });
}
