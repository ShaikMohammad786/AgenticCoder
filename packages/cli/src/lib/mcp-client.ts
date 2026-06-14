/**
 * MCP (Model Context Protocol) Client
 *
 * Connects to external MCP servers defined in .agenticcoder/mcp.json,
 * discovers their tools, and proxies tool calls from the AI.
 *
 * MCP Config format (.agenticcoder/mcp.json):
 * {
 *   "mcpServers": {
 *     "server-name": {
 *       "command": "npx",
 *       "args": ["-y", "@some/mcp-server"],
 *       "env": { "API_KEY": "..." }
 *     }
 *   }
 * }
 *
 * Each MCP server is launched as a subprocess communicating via JSON-RPC
 * over stdin/stdout (the standard MCP stdio transport).
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Subprocess } from "bun";

// ─── Types ───────────────────────────────────────────────────────

interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

interface McpConnection {
  name: string;
  process: Subprocess;
  tools: McpToolDefinition[];
  requestId: number;
  pendingRequests: Map<number, {
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
  }>;
  buffer: string;
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// ─── State ───────────────────────────────────────────────────────

const connections: Map<string, McpConnection> = new Map();

// ─── Config ──────────────────────────────────────────────────────

/**
 * Load MCP config from .agenticcoder/mcp.json
 */
export function loadMcpConfig(cwd?: string): McpConfig | null {
  const root = cwd ?? process.cwd();
  const configPath = join(root, ".agenticcoder", "mcp.json");

  if (!existsSync(configPath)) return null;

  try {
    const raw = readFileSync(configPath, "utf8");
    return JSON.parse(raw) as McpConfig;
  } catch {
    return null;
  }
}

// ─── JSON-RPC helpers ────────────────────────────────────────────

function sendRequest(conn: McpConnection, method: string, params?: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = ++conn.requestId;
    conn.pendingRequests.set(id, { resolve, reject });

    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      ...(params ? { params } : {}),
    };

    const message = JSON.stringify(request) + "\n";
    conn.process.stdin?.write(message);
  });
}

function handleStdout(conn: McpConnection, chunk: string) {
  conn.buffer += chunk;

  // Process complete JSON lines
  const lines = conn.buffer.split("\n");
  conn.buffer = lines.pop() ?? ""; // Keep incomplete last line

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const response = JSON.parse(trimmed) as JsonRpcResponse;
      if (response.id != null) {
        const pending = conn.pendingRequests.get(response.id);
        if (pending) {
          conn.pendingRequests.delete(response.id);
          if (response.error) {
            pending.reject(new Error(response.error.message));
          } else {
            pending.resolve(response.result);
          }
        }
      }
    } catch {
      // Skip malformed JSON
    }
  }
}

// ─── Connection Management ───────────────────────────────────────

/**
 * Connect to a single MCP server and discover its tools.
 */
async function connectToServer(
  name: string,
  config: McpServerConfig,
): Promise<McpConnection> {
  const env = {
    ...process.env,
    ...(config.env ?? {}),
  };

  const proc = Bun.spawn([config.command, ...(config.args ?? [])], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env,
  });

  const conn: McpConnection = {
    name,
    process: proc,
    tools: [],
    requestId: 0,
    pendingRequests: new Map(),
    buffer: "",
  };

  // Read stdout in background
  (async () => {
    const reader = proc.stdout?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        handleStdout(conn, decoder.decode(value, { stream: true }));
      }
    } catch {
      // Process ended
    }
  })();

  // Initialize the MCP connection
  try {
    await sendRequest(conn, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "agenticcoder", version: "1.0.0" },
    });

    // Send initialized notification
    const notification = JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }) + "\n";
    conn.process.stdin?.write(notification);

    // Discover tools
    const toolsResult = (await sendRequest(conn, "tools/list")) as {
      tools: McpToolDefinition[];
    };
    conn.tools = toolsResult?.tools ?? [];
  } catch (error) {
    // If initialization fails, kill the process
    proc.kill();
    throw error;
  }

  return conn;
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Initialize all MCP servers from config.
 * Returns the number of servers connected + total tools discovered.
 */
export async function initializeMcp(cwd?: string): Promise<{
  servers: number;
  tools: number;
  errors: string[];
}> {
  const config = loadMcpConfig(cwd);
  if (!config || !config.mcpServers) {
    return { servers: 0, tools: 0, errors: [] };
  }

  const errors: string[] = [];
  let totalTools = 0;

  for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
    if (connections.has(name)) {
      // Already connected
      totalTools += connections.get(name)!.tools.length;
      continue;
    }

    try {
      const conn = await connectToServer(name, serverConfig);
      connections.set(name, conn);
      totalTools += conn.tools.length;
    } catch (error) {
      errors.push(
        `${name}: ${error instanceof Error ? error.message : "Failed to connect"}`
      );
    }
  }

  return { servers: connections.size, tools: totalTools, errors };
}

/**
 * Get all tools from all connected MCP servers.
 * Returns tools with server-prefixed names to avoid conflicts.
 */
export function getAllMcpTools(): {
  name: string;
  serverName: string;
  description: string;
  inputSchema: Record<string, unknown>;
}[] {
  const tools: {
    name: string;
    serverName: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }[] = [];

  for (const [serverName, conn] of connections) {
    for (const tool of conn.tools) {
      tools.push({
        name: `mcp_${serverName}_${tool.name}`,
        serverName,
        description: tool.description ?? `MCP tool from ${serverName}`,
        inputSchema: tool.inputSchema,
      });
    }
  }

  return tools;
}

/**
 * Call an MCP tool by its prefixed name.
 */
export async function callMcpTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  // Parse "mcp_serverName_toolName" format
  const match = toolName.match(/^mcp_([^_]+)_(.+)$/);
  if (!match) {
    throw new Error(`Invalid MCP tool name format: ${toolName}`);
  }

  const [, serverName, actualToolName] = match;
  const conn = connections.get(serverName!);

  if (!conn) {
    throw new Error(`MCP server "${serverName}" is not connected`);
  }

  const result = await sendRequest(conn, "tools/call", {
    name: actualToolName,
    arguments: args,
  });

  return result;
}

/**
 * Check if any MCP servers are configured.
 */
export function hasMcpConfig(cwd?: string): boolean {
  return loadMcpConfig(cwd) !== null;
}

/**
 * Get the connection status of all MCP servers.
 */
export function getMcpStatus(): {
  name: string;
  connected: boolean;
  toolCount: number;
  tools: string[];
}[] {
  const status: {
    name: string;
    connected: boolean;
    toolCount: number;
    tools: string[];
  }[] = [];

  for (const [name, conn] of connections) {
    status.push({
      name,
      connected: !conn.process.killed,
      toolCount: conn.tools.length,
      tools: conn.tools.map((t) => t.name),
    });
  }

  return status;
}

/**
 * Disconnect all MCP servers.
 */
export function disconnectAll(): void {
  for (const [, conn] of connections) {
    try {
      conn.process.kill();
    } catch {
      // ignore
    }
  }
  connections.clear();
}

/**
 * Alias for callMcpTool — used by local-tools.ts
 */
export const executeMcpTool = callMcpTool;

/**
 * Check if a tool name is an MCP tool (prefixed with "mcp_").
 */
export function isMcpTool(toolName: string): boolean {
  return toolName.startsWith("mcp_");
}
