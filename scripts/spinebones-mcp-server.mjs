#!/usr/bin/env node

import process from 'node:process';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import * as z from 'zod/v4';

const bridgeUrl = process.env.SPINEBONES_MCP_URL ?? 'http://127.0.0.1:48570';
const serverPort = Number.parseInt(process.env.SPINEBONES_MCP_PORT ?? '48600', 10);
const transportMode = process.env.SPINEBONES_MCP_TRANSPORT === 'http' ? 'http' : 'stdio';

const requestJson = async (path, init) => {
  const response = await fetch(`${bridgeUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Bridge request failed (${response.status} ${response.statusText})`);
  }

  return response.json();
};

const asTextResult = (label, payload) => ({
  content: [
    {
      type: 'text',
      text: `${label}\n${JSON.stringify(payload, null, 2)}`,
    },
  ],
});

const createServer = () => {
  const server = new McpServer({
    name: 'spinebones-editor',
    version: '0.1.3',
  });

  server.registerTool(
    'spinebones_health',
    {
      description: 'Check whether the local SpineBones editor bridge is reachable.',
      inputSchema: {},
    },
    async () => {
      const result = await requestJson('/health');
      return asTextResult('SpineBones bridge health', result);
    },
  );

  server.registerTool(
    'spinebones_get_editor_state',
    {
      description: 'Read the live state snapshot from the currently running SpineBones editor.',
      inputSchema: {},
    },
    async () => {
      const result = await requestJson('/state');
      return asTextResult('SpineBones editor state', result);
    },
  );

  server.registerTool(
    'spinebones_apply_animation_prompt',
    {
      description:
        'Send a freeform animation prompt to the running SpineBones editor and apply it to the current timeline. Supports idle, walk, run, jump, land, and simple attack prompts.',
      inputSchema: {
        prompt: z.string().min(1).describe('Animation prompt such as "create a quick slash attack", "make a run cycle", or "create a jump with soft landing".'),
      },
    },
    async ({ prompt }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'apply_animation_prompt',
          prompt,
        }),
      });

      return asTextResult('Animation prompt accepted by SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_apply_idle_prompt',
    {
      description:
        'Send a freeform idle animation prompt to the running SpineBones editor and apply it to the current timeline.',
      inputSchema: {
        prompt: z.string().min(1).describe('Idle prompt seperti "buat idle napas pelan dan rambut sedikit sway".'),
      },
    },
    async ({ prompt }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'apply_idle_prompt',
          prompt,
        }),
      });

      return asTextResult('Idle prompt accepted by SpineBones', result);
    },
  );

  return server;
};

if (transportMode === 'http') {
  const app = createMcpExpressApp();

  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      mode: 'streamable-http',
      bridgeUrl,
      port: serverPort,
      mcpUrl: `http://127.0.0.1:${serverPort}/mcp`,
    });
  });

  app.post('/mcp', async (req, res) => {
    const server = createServer();

    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);

      res.on('close', () => {
        void transport.close();
        void server.close();
      });
    } catch (error) {
      console.error('Error handling SpineBones MCP HTTP request:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error',
          },
          id: null,
        });
      }
    }
  });

  app.get('/mcp', async (_req, res) => {
    res.writeHead(405).end(JSON.stringify({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Method not allowed.',
      },
      id: null,
    }));
  });

  app.delete('/mcp', async (_req, res) => {
    res.writeHead(405).end(JSON.stringify({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Method not allowed.',
      },
      id: null,
    }));
  });

  app.listen(serverPort, (error) => {
    if (error) {
      console.error('Failed to start SpineBones MCP HTTP server:', error);
      process.exit(1);
    }

    console.error(`SpineBones MCP server ready via streamable HTTP -> http://127.0.0.1:${serverPort}/mcp`);
  });
} else {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`SpineBones MCP server ready via stdio -> ${bridgeUrl}`);
}
