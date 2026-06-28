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
import { getEnvValue } from "./env-file";

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
  buffer: Buffer;
  stderr: string;
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
const scopedConnections: Map<string, Map<string, McpConnection>> = new Map();
const REQUEST_TIMEOUT_MS = 30_000;
const CONNECT_TIMEOUT_MS = 45_000;
const MAX_STDERR_LENGTH = 8_000;
const JSON_SCHEMA_TYPES = new Set(["object", "array", "string", "number", "integer", "boolean", "null"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeJsonSchemaValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeJsonSchemaValue);
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const normalized: Record<string, unknown> = {};
  for (const [key, childValue] of Object.entries(value)) {
    normalized[key] = normalizeJsonSchemaValue(childValue);
  }

  if (typeof normalized.type === "string" && !JSON_SCHEMA_TYPES.has(normalized.type)) {
    delete normalized.type;
  }

  return normalized;
}

function normalizeToolInputSchema(schema: unknown): Record<string, unknown> {
  const normalized = normalizeJsonSchemaValue(schema);
  if (!isPlainObject(normalized)) {
    return { type: "object", properties: {} };
  }

  if (normalized.type !== "object") {
    normalized.type = "object";
  }

  if (!isPlainObject(normalized.properties)) {
    normalized.properties = {};
  }

  return normalized;
}

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

    // Per-request timeout
    const timer = setTimeout(() => {
      conn.pendingRequests.delete(id);
      reject(new Error(`MCP request timed out after ${REQUEST_TIMEOUT_MS / 1000}s: ${method}${formatStderr(conn)}`));
    }, REQUEST_TIMEOUT_MS);

    const origResolve = resolve;
    const origReject = reject;
    conn.pendingRequests.set(id, {
      resolve: (val) => { clearTimeout(timer); origResolve(val); },
      reject: (err) => { clearTimeout(timer); origReject(err); },
    });

    conn.process.stdin?.write(encodeMessage(request));
  });
}

function sendNotification(conn: McpConnection, method: string, params?: Record<string, unknown>) {
  conn.process.stdin?.write(encodeMessage({
    jsonrpc: "2.0",
    method,
    ...(params ? { params } : {}),
  }));
}

function encodeMessage(message: unknown): string {
  return `${JSON.stringify(message)}\n`;
}

function handleStdout(conn: McpConnection, chunk: Uint8Array) {
  conn.buffer = Buffer.concat([conn.buffer, Buffer.from(chunk)]);

  while (true) {
    const bufferTextStart = conn.buffer.subarray(0, Math.min(conn.buffer.length, 64)).toString("utf8");
    if (/^content-length:/i.test(bufferTextStart)) {
      if (!handleContentLengthMessage(conn)) return;
      continue;
    }

    const newlineIndex = conn.buffer.indexOf("\n");
    if (newlineIndex === -1) return;

    const line = conn.buffer.subarray(0, newlineIndex).toString("utf8").trim();
    conn.buffer = conn.buffer.subarray(newlineIndex + 1);
    if (!line) continue;

    handleJsonRpcMessage(conn, line);
  }
}

function handleContentLengthMessage(conn: McpConnection): boolean {
  const headerEnd = conn.buffer.indexOf("\r\n\r\n");
  if (headerEnd === -1) return false;

  const header = conn.buffer.subarray(0, headerEnd).toString("utf8");
  const contentLengthMatch = header.match(/content-length:\s*(\d+)/i);
  if (!contentLengthMatch) {
    conn.buffer = conn.buffer.subarray(headerEnd + 4);
    return true;
  }

  const contentLength = Number(contentLengthMatch[1]);
  if (!Number.isFinite(contentLength)) {
    conn.buffer = conn.buffer.subarray(headerEnd + 4);
    return true;
  }

  const bodyStart = headerEnd + 4;
  const bodyEnd = bodyStart + contentLength;
  if (conn.buffer.length < bodyEnd) return false;

  const body = conn.buffer.subarray(bodyStart, bodyEnd).toString("utf8");
  conn.buffer = conn.buffer.subarray(bodyEnd);
  handleJsonRpcMessage(conn, body);
  return true;
}

function handleJsonRpcMessage(conn: McpConnection, body: string) {
  try {
    const response = JSON.parse(body) as JsonRpcResponse;
    if (response.id == null) return;

    const pending = conn.pendingRequests.get(response.id);
    if (!pending) return;

    conn.pendingRequests.delete(response.id);
    if (response.error) {
      pending.reject(new Error(`${response.error.message}${formatStderr(conn)}`));
    } else {
      pending.resolve(response.result);
    }
  } catch {
    // Skip malformed messages.
  }
}

function appendStderr(conn: McpConnection, chunk: string) {
  conn.stderr = `${conn.stderr}${chunk}`.slice(-MAX_STDERR_LENGTH);
}

function formatStderr(conn: McpConnection) {
  const stderr = conn.stderr.trim();
  return stderr ? `\nMCP stderr [${conn.name}]:\n${stderr}` : "";
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, onTimeout: () => void, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout();
      reject(new Error(`${label} timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
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
    ...resolveConfiguredEnv(config.env),
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
    buffer: Buffer.alloc(0),
    stderr: "",
  };

  // Read stdout in background
  (async () => {
    const reader = proc.stdout?.getReader();
    if (!reader) return;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        handleStdout(conn, value);
      }
    } catch {
      // Process ended
    }
  })();

  // Read stderr in background so failures are visible in status/errors.
  (async () => {
    const reader = proc.stderr?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        appendStderr(conn, decoder.decode(value, { stream: true }));
      }
    } catch {
      // Process ended
    }
  })();

  // Initialize the MCP connection
  try {
    await withTimeout(sendRequest(conn, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "agenticcoder", version: "1.0.0" },
    }), CONNECT_TIMEOUT_MS, () => proc.kill(), `MCP server "${name}" initialize`);

    // Send initialized notification
    sendNotification(conn, "notifications/initialized");

    // Discover tools
    const toolsResult = (await withTimeout(
      sendRequest(conn, "tools/list"),
      CONNECT_TIMEOUT_MS,
      () => proc.kill(),
      `MCP server "${name}" tools/list`,
    )) as {
      tools: McpToolDefinition[];
    };
    conn.tools = toolsResult?.tools ?? [];
  } catch (error) {
    // If initialization fails, kill the process
    proc.kill();
    throw new Error(`${error instanceof Error ? error.message : String(error)}${formatStderr(conn)}`);
  }

  return conn;
}

function safeScopeName(scopeId: string): string {
  return scopeId.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 80) || "default";
}

function withScopedServerConfig(serverName: string, config: McpServerConfig, scopeId?: string): McpServerConfig {
  if (!scopeId) return config;

  const scopedConfig: McpServerConfig = {
    ...config,
    args: [...(config.args ?? [])],
    env: {
      ...(config.env ?? {}),
      AGENTICCODER_TOOL_SCOPE: scopeId,
    },
  };

  const packageArgs = scopedConfig.args.map((arg) => arg.toLowerCase());
  const isPlaywright = serverName === "playwright" || packageArgs.some((arg) => arg.includes("@playwright/mcp"));
  if (!isPlaywright) return scopedConfig;

  const outputDir = join(".agenticcoder", "playwright-output", safeScopeName(scopeId));
  const outputDirIndex = scopedConfig.args.indexOf("--output-dir");
  if (outputDirIndex >= 0) {
    scopedConfig.args[outputDirIndex + 1] = outputDir;
  } else {
    scopedConfig.args.push("--output-dir", outputDir);
  }

  return scopedConfig;
}

async function getScopedConnection(serverName: string, scopeId: string): Promise<McpConnection> {
  let scopeConnections = scopedConnections.get(scopeId);
  if (!scopeConnections) {
    scopeConnections = new Map();
    scopedConnections.set(scopeId, scopeConnections);
  }

  const existing = scopeConnections.get(serverName);
  if (existing && !existing.process.killed) return existing;

  const config = loadMcpConfig();
  const serverConfig = config?.mcpServers?.[serverName];
  if (!serverConfig) {
    throw new Error(`MCP server "${serverName}" is not configured`);
  }

  const conn = await connectToServer(serverName, withScopedServerConfig(serverName, serverConfig, scopeId));
  scopeConnections.set(serverName, conn);
  return conn;
}

function resolveConfiguredEnv(env?: Record<string, string>) {
  if (!env) return {};

  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    resolved[key] = value || getEnvValue(key) || "";
  }
  return resolved;
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

  const entries = Object.entries(config.mcpServers);
  const results = await Promise.all(entries.map(async ([name, serverConfig]) => {
    if (connections.has(name)) {
      // Already connected
      return connections.get(name)!.tools.length;
    }

    try {
      const conn = await connectToServer(name, serverConfig);
      connections.set(name, conn);
      return conn.tools.length;
    } catch (error) {
      errors.push(
        `${name}: ${error instanceof Error ? error.message : "Failed to connect"}`
      );
      return 0;
    }
  }));

  totalTools = results.reduce((sum, count) => sum + count, 0);

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
        inputSchema: normalizeToolInputSchema(tool.inputSchema),
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
  options?: { scopeId?: string },
): Promise<unknown> {
  // Parse "mcp_serverName_toolName" format
  const match = toolName.match(/^mcp_([^_]+)_(.+)$/);
  if (!match) {
    throw new Error(`Invalid MCP tool name format: ${toolName}`);
  }

  const [, serverName, actualToolName] = match;
  const conn = options?.scopeId
    ? await getScopedConnection(serverName!, options.scopeId)
    : connections.get(serverName!);

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
  stderr?: string;
}[] {
  const status: {
    name: string;
    connected: boolean;
    toolCount: number;
    tools: string[];
    stderr?: string;
  }[] = [];

  for (const [name, conn] of connections) {
    status.push({
      name,
      connected: !conn.process.killed,
      toolCount: conn.tools.length,
      tools: conn.tools.map((t) => t.name),
      ...(conn.stderr.trim() ? { stderr: conn.stderr.trim() } : {}),
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
  for (const [, scopeConnections] of scopedConnections) {
    for (const [, conn] of scopeConnections) {
      try {
        conn.process.kill();
      } catch {
        // ignore
      }
    }
  }
  scopedConnections.clear();
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

/**
 * Graceful shutdown — kill all MCP server processes.
 * Called on CLI exit to prevent orphaned processes.
 */
export function shutdownMcp(): void {
  for (const [name, conn] of connections) {
    try {
      conn.process.kill();
    } catch {
      // Process already dead
    }
  }
  connections.clear();
  for (const [, scopeConnections] of scopedConnections) {
    for (const [, conn] of scopeConnections) {
      try {
        conn.process.kill();
      } catch {
        // Process already dead
      }
    }
  }
  scopedConnections.clear();
}

export function shutdownMcpScope(scopeId: string): void {
  const scopeConnections = scopedConnections.get(scopeId);
  if (!scopeConnections) return;

  for (const [, conn] of scopeConnections) {
    try {
      conn.process.kill();
    } catch {
      // Process already dead
    }
  }
  scopedConnections.delete(scopeId);
}
