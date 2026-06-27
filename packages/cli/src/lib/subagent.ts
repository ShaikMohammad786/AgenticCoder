import { mkdirSync, appendFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { AgentTypeValue, ModeType } from "@agenticcoder/shared";
import { AGENT_SYSTEM_PROMPTS, AGENT_CONFIGS, type AgentConfig } from "./agent-prompts";
import { apiClient } from "./api-client";
import { getAuth } from "./auth";
import { executeLocalTool } from "./local-tools";

// ─── Types ────────────────────────────────────────────────────────────

export type SubAgentRequest = {
  type: AgentTypeValue;
  task: string;
  context?: string;
  files?: string[];
};

export type SubAgentResult = {
  agentId: string;
  type: AgentTypeValue;
  status: "completed" | "failed" | "timeout" | "aborted";
  summary: string;
  filesChanged: string[];
  errors: string[];
  durationMs: number;
  toolCallCount: number;
};

type SubAgentLogEntry = {
  timestamp: string;
  agentId: string;
  type: AgentTypeValue;
  event: string;
  data?: unknown;
};

export type SubAgentExternalTool = {
  name: string;
  description?: string;
  inputSchema?: unknown;
};

export type SubAgentRuntimeContext = {
  projectContext?: string;
  memories?: string;
  externalTools?: SubAgentExternalTool[];
};

type SubAgentMessage = {
  id: string;
  role: "user" | "assistant";
  parts: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
};

type SubAgentToolCall = {
  toolCallId: string;
  toolName: string;
  input: unknown;
  part: Record<string, unknown>;
};

// ─── Logging (Filesystem-based, like Antigravity/Claude Code) ──────────

const LOG_DIR = join(homedir(), ".agenticcoder", "subagent-logs");

function ensureLogDir(): void {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
}

function getLogPath(sessionId: string, agentId: string): string {
  const sessionDir = join(LOG_DIR, sessionId);
  if (!existsSync(sessionDir)) {
    mkdirSync(sessionDir, { recursive: true });
  }
  return join(sessionDir, `${agentId}.jsonl`);
}

function appendLog(logPath: string, entry: SubAgentLogEntry): void {
  try {
    appendFileSync(logPath, JSON.stringify(entry) + "\n");
  } catch {
    // Non-critical — don't crash if logging fails
  }
}

// ─── Single SubAgent Execution ─────────────────────────────────────────

let agentCounter = 0;

function generateAgentId(type: AgentTypeValue): string {
  return `${type}-${++agentCounter}-${Date.now().toString(36)}`;
}

/**
 * Execute a single subagent — sends its task to the server, streams
 * the response, executes tool calls locally, and collects results.
 */
async function executeSubAgent(
  request: SubAgentRequest,
  agentId: string,
  sessionId: string,
  parentModel: string,
  parentMode: string,
  runtimeContext: SubAgentRuntimeContext,
  logPath: string,
  abortSignal: AbortSignal,
): Promise<SubAgentResult> {
  const config = AGENT_CONFIGS[request.type];
  const startTime = Date.now();
  const filesChanged: string[] = [];
  const errors: string[] = [];
  let toolCallCount = 0;
  let finalSummary = "";

  appendLog(logPath, {
    timestamp: new Date().toISOString(),
    agentId,
    type: request.type,
    event: "started",
    data: { task: request.task, files: request.files },
  });

  try {
    // Build the subagent's focused system prompt
    const systemPrompt = buildSubAgentPrompt(request, config, runtimeContext);

    // Build the initial user message for the subagent
    const userMessage = buildSubAgentUserMessage(request);
    const messages: SubAgentMessage[] = [
      {
        id: `subagent-${agentId}-user`,
        role: "user",
        parts: [{ type: "text", text: userMessage }],
      },
    ];
    const inheritedToolNames = runtimeContext.externalTools?.map((tool) => tool.name) ?? [];
    const allowedTools = [...new Set([...config.allowedTools, ...inheritedToolNames])];
    const builtInToolMode: ModeType = config.isReadOnly || parentMode === "PLAN" ? "PLAN" : "BUILD";
    const inheritedToolMode: ModeType = parentMode === "PLAN" ? "PLAN" : "BUILD";

    for (let step = 0; step < config.maxSteps; step++) {
      const response = await fetchSubAgentStream({
        sessionId,
        agentId,
        agentType: request.type,
        model: parentModel,
        mode: inheritedToolMode,
        systemPrompt,
        userMessage,
        config,
        allowedTools,
        externalTools: runtimeContext.externalTools ?? [],
        messages,
        abortSignal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        throw new Error(`Subagent API error (${response.status}): ${errorText}`);
      }

      const turn = await collectSubAgentTurn(response, agentId, request.type, logPath, abortSignal);
      if (turn.assistantMessage) {
        messages.push(turn.assistantMessage);
      }
      if (turn.text.trim()) {
        finalSummary = turn.text.trim();
      }

      if (turn.toolCalls.length === 0) {
        break;
      }

      for (const toolCall of turn.toolCalls) {
        toolCallCount++;

        const isBuiltIn = config.allowedTools.includes(toolCall.toolName);
        const output = await executeSubAgentToolCall({
          toolCall,
          agentId,
          agentType: request.type,
          allowedTools,
          logPath,
          mode: isBuiltIn ? builtInToolMode : inheritedToolMode,
          sessionId,
          parentModel,
          filesChanged,
          errors,
        });

        if (turn.assistantMessage) {
          applyToolOutputToMessage(turn.assistantMessage, toolCall, output);
        }
      }

      if (step === config.maxSteps - 1) {
        errors.push(`Reached maximum subagent steps (${config.maxSteps}) before a final answer.`);
      }
    }

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    
    if (abortSignal.aborted || message.includes("abort")) {
      appendLog(logPath, {
        timestamp: new Date().toISOString(),
        agentId,
        type: request.type,
        event: "timeout",
        data: { durationMs: Date.now() - startTime },
      });

      return {
        agentId,
        type: request.type,
        status: "timeout",
        summary: `Agent timed out after ${Math.round((Date.now() - startTime) / 1000)}s. Partial work may have been done.`,
        filesChanged,
        errors: [...errors, `Timeout: ${message}`],
        durationMs: Date.now() - startTime,
        toolCallCount,
      };
    }

    errors.push(message);
    appendLog(logPath, {
      timestamp: new Date().toISOString(),
      agentId,
      type: request.type,
      event: "error",
      data: { error: message },
    });
  }

  const durationMs = Date.now() - startTime;

  appendLog(logPath, {
    timestamp: new Date().toISOString(),
    agentId,
    type: request.type,
    event: "completed",
    data: { durationMs, toolCallCount, filesChanged, status: errors.length > 0 ? "failed" : "completed" },
  });

  return {
    agentId,
    type: request.type,
    status: errors.length > 0 && !finalSummary ? "failed" : "completed",
    summary: finalSummary || `Agent ${request.type} completed with ${errors.length} error(s).`,
    filesChanged,
    errors,
    durationMs,
    toolCallCount,
  };
}

// ─── Prompt Builders ──────────────────────────────────────────────────

function buildSubAgentPrompt(
  request: SubAgentRequest,
  config: AgentConfig,
  runtimeContext: SubAgentRuntimeContext,
): string {
  const basePrompt = AGENT_SYSTEM_PROMPTS[request.type];
  
  const toolList = config.allowedTools.map(t => `- **${t}**`).join("\n");
  const externalTools = (runtimeContext.externalTools ?? [])
    .slice(0, 60)
    .map((tool) => `- **${tool.name}**${tool.description ? `: ${tool.description}` : ""}`)
    .join("\n");

  const externalToolContext = [
    `## AgenticCoder Runtime Context`,
    runtimeContext.projectContext ? runtimeContext.projectContext : `No parent project context was provided.`,
    runtimeContext.memories ? `\n## Relevant Memory\n${runtimeContext.memories}` : "",
    externalTools ? `\n## Inherited Plugin/MCP Tools\n${externalTools}` : "",
    `Plugin tools are named \`plugin_<name>\`; MCP tools are named \`mcp_<server>_<tool>\`. If listed above, you may call them directly.`,
    `Read-only subagents must avoid external tools with obvious write or destructive side effects.`,
    `Never ask for or print secret values. Refer only to required env var names.`,
  ].filter(Boolean).join("\n");
  
  const constraints = [
    `## Constraints`,
    `- You have a maximum of ${config.maxSteps} tool call steps.`,
    `- Timeout: ${config.timeoutMs / 1000} seconds.`,
    config.isReadOnly 
      ? `- You are READ-ONLY. Do not attempt to write files or run bash commands.`
      : `- You have write access. Use it responsibly.`,
    `- Stay focused on your assigned task. Do not expand scope.`,
    `- Be concise in your responses — the parent agent will read your output.`,
  ].join("\n");

  return `${basePrompt}\n\n${externalToolContext}\n\n## Available Tools\n${toolList}\n\n${constraints}`;
}

function buildSubAgentUserMessage(request: SubAgentRequest): string {
  const parts: string[] = [];
  
  parts.push(`## Task\n${request.task}`);
  
  if (request.context) {
    parts.push(`\n## Context from Parent Agent\n${request.context}`);
  }
  
  if (request.files && request.files.length > 0) {
    parts.push(`\n## Key Files to Focus On\n${request.files.map(f => `- \`${f}\``).join("\n")}`);
  }
  
  parts.push(`\nBegin working on this task now. Start by reading the relevant files.`);
  
  return parts.join("\n");
}

// ─── API Communication ──────────────────────────────────────────────

async function fetchSubAgentStream(opts: {
  sessionId: string;
  agentId: string;
  agentType: AgentTypeValue;
  model: string;
  mode: string;
  systemPrompt: string;
  userMessage: string;
  config: AgentConfig;
  allowedTools?: string[];
  externalTools?: SubAgentExternalTool[];
  messages?: SubAgentMessage[];
  abortSignal: AbortSignal;
}): Promise<Response> {
  const auth = getAuth();
  const chatUrl = apiClient.chat.$url().toString();
  // Use the same chat endpoint — subagent flag tells server to use custom system prompt
  const subagentUrl = chatUrl.replace("/chat", "/chat/subagent");

  return fetch(subagentUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { Authorization: `Bearer ${auth.token}` } : {}),
    },
    body: JSON.stringify({
      sessionId: opts.sessionId,
      agentId: opts.agentId,
      agentType: opts.agentType,
      model: opts.model,
      mode: opts.mode,
      systemPrompt: opts.systemPrompt,
      userMessage: opts.userMessage,
      maxSteps: opts.config.maxSteps,
      allowedTools: opts.allowedTools ?? opts.config.allowedTools,
      externalTools: opts.externalTools ?? [],
      ...(opts.messages ? { messages: opts.messages } : {}),
    }),
    signal: opts.abortSignal,
  });
}

// ─── Stream Processing ──────────────────────────────────────────────

type SubAgentTurn = {
  text: string;
  assistantMessage?: SubAgentMessage;
  toolCalls: SubAgentToolCall[];
};

type ToolExecutionOutput =
  | { ok: true; output: unknown }
  | { ok: false; errorText: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function collectTextDelta(event: Record<string, unknown>): string {
  return getString(event.text)
    ?? getString(event.textDelta)
    ?? getString(event.delta)
    ?? "";
}

function getToolCallName(event: Record<string, unknown>, fallback?: string): string | undefined {
  return getString(event.toolName) ?? getString(event.name) ?? fallback;
}

function getToolCallId(event: Record<string, unknown>, fallbackName: string): string {
  return getString(event.toolCallId)
    ?? getString(event.id)
    ?? `subagent-tool-${fallbackName}-${Date.now().toString(36)}`;
}

function getToolCallInput(event: Record<string, unknown>, streamedInput?: string): unknown {
  if ("input" in event) return event.input;
  if ("args" in event) return event.args;

  if (streamedInput) {
    try {
      return JSON.parse(streamedInput);
    } catch {
      return streamedInput;
    }
  }

  return {};
}

function createToolPart(toolCall: SubAgentToolCall): Record<string, unknown> {
  return {
    type: `tool-${toolCall.toolName}`,
    toolCallId: toolCall.toolCallId,
    state: "input-available",
    input: toolCall.input,
  };
}

function applyToolOutputToMessage(
  message: SubAgentMessage,
  toolCall: SubAgentToolCall,
  result: ToolExecutionOutput,
): void {
  message.parts = message.parts.map((part) => {
    if (part.toolCallId !== toolCall.toolCallId) return part;

    if (result.ok) {
      return {
        ...part,
        state: "output-available",
        output: result.output,
      };
    }

    return {
      ...part,
      state: "output-error",
      errorText: result.errorText,
    };
  });
}

async function collectSubAgentTurn(
  response: Response,
  agentId: string,
  agentType: AgentTypeValue,
  logPath: string,
  abortSignal: AbortSignal,
): Promise<SubAgentTurn> {
  if (!response.body) {
    throw new Error("No response body from subagent stream");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const textChunks: string[] = [];
  const toolCallsById = new Map<string, SubAgentToolCall>();
  const pendingToolInputs = new Map<string, { toolName?: string; chunks: string[] }>();
  let messageId = `subagent-${agentId}-assistant-${Date.now().toString(36)}`;
  let buffer = "";

  const addToolCall = (event: Record<string, unknown>, streamedInput?: string) => {
    const toolName = getToolCallName(event);
    if (!toolName) return;

    const toolCallId = getToolCallId(event, toolName);
    if (toolCallsById.has(toolCallId)) return;

    const toolCall: SubAgentToolCall = {
      toolCallId,
      toolName,
      input: getToolCallInput(event, streamedInput),
      part: {},
    };
    toolCall.part = createToolPart(toolCall);
    toolCallsById.set(toolCallId, toolCall);

    appendLog(logPath, {
      timestamp: new Date().toISOString(),
      agentId,
      type: agentType,
      event: "tool-requested",
      data: { tool: toolName },
    });
  };

  try {
    while (true) {
      if (abortSignal.aborted) break;

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";

      for (const rawLine of lines) {
        let line = rawLine.trim();
        if (!line) continue;
        if (line.startsWith("data:")) line = line.slice(5).trim();
        if (!line || line === "[DONE]" || !line.startsWith("{")) continue;

        try {
          const event = JSON.parse(line) as Record<string, unknown>;
          const type = getString(event.type);

          if (type === "start" && getString(event.messageId)) {
            messageId = getString(event.messageId)!;
            continue;
          }

          if (type === "text" || type === "text-delta") {
            textChunks.push(collectTextDelta(event));
            continue;
          }

          if (type === "tool-input-start") {
            const toolName = getToolCallName(event);
            const toolCallId = getToolCallId(event, toolName ?? "unknown");
            pendingToolInputs.set(toolCallId, { toolName, chunks: [] });
            continue;
          }

          if (type === "tool-input-delta") {
            const toolCallId = getString(event.toolCallId) ?? getString(event.id);
            if (!toolCallId) continue;

            const pending = pendingToolInputs.get(toolCallId) ?? { chunks: [] };
            pending.chunks.push(getString(event.inputTextDelta) ?? getString(event.delta) ?? "");
            pendingToolInputs.set(toolCallId, pending);
            continue;
          }

          if (type === "tool-input-available" || type === "tool-call") {
            const toolCallId = getString(event.toolCallId) ?? getString(event.id);
            const pending = toolCallId ? pendingToolInputs.get(toolCallId) : undefined;
            addToolCall(
              {
                ...event,
                toolName: getToolCallName(event, pending?.toolName),
              },
              pending?.chunks.join(""),
            );
          }
        } catch {
          // Ignore partial or non-JSON stream frames.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  const text = textChunks.join("");
  const toolCalls = Array.from(toolCallsById.values());
  const parts: Array<Record<string, unknown>> = [];

  if (text.trim()) {
    parts.push({ type: "text", text });
  }

  for (const toolCall of toolCalls) {
    parts.push(toolCall.part);
  }

  return {
    text,
    toolCalls,
    assistantMessage: parts.length > 0
      ? { id: messageId, role: "assistant", parts }
      : undefined,
  };
}

async function executeSubAgentToolCall(opts: {
  toolCall: SubAgentToolCall;
  agentId: string;
  agentType: AgentTypeValue;
  allowedTools: string[];
  logPath: string;
  mode: ModeType;
  sessionId: string;
  parentModel: string;
  filesChanged: string[];
  errors: string[];
}): Promise<ToolExecutionOutput> {
  const {
    toolCall,
    agentId,
    agentType,
    allowedTools,
    logPath,
    mode,
    sessionId,
    parentModel,
    filesChanged,
    errors,
  } = opts;

  if (!allowedTools.includes(toolCall.toolName)) {
    const errorText = `Tool ${toolCall.toolName} is not allowed for ${agentType} subagents.`;
    errors.push(errorText);
    appendLog(logPath, {
      timestamp: new Date().toISOString(),
      agentId,
      type: agentType,
      event: "tool-blocked",
      data: { tool: toolCall.toolName },
    });
    return { ok: false, errorText };
  }

  try {
    const output = await executeLocalTool(
      toolCall.toolName,
      toolCall.input,
      mode,
      { sessionId, model: parentModel },
    );

    if (["writeFile", "editFile", "searchReplace"].includes(toolCall.toolName) && isRecord(toolCall.input)) {
      const path = getString(toolCall.input.path);
      if (path && !filesChanged.includes(path)) {
        filesChanged.push(path);
      }
    }

    appendLog(logPath, {
      timestamp: new Date().toISOString(),
      agentId,
      type: agentType,
      event: "tool-executed",
      data: { tool: toolCall.toolName, path: isRecord(toolCall.input) ? toolCall.input.path : undefined },
    });

    return { ok: true, output };
  } catch (error) {
    const errorText = error instanceof Error ? error.message : String(error);
    errors.push(`Tool ${toolCall.toolName} failed: ${errorText}`);
    appendLog(logPath, {
      timestamp: new Date().toISOString(),
      agentId,
      type: agentType,
      event: "tool-error",
      data: { tool: toolCall.toolName, error: errorText },
    });
    return { ok: false, errorText };
  }
}

async function legacyProcessSubAgentStream(
  response: Response,
  agentId: string,
  agentType: AgentTypeValue,
  config: AgentConfig,
  logPath: string,
  abortSignal: AbortSignal,
  filesChanged: string[],
  errors: string[],
  setToolCallCount: (count: number) => void,
): Promise<string> {
  let fullText = "";
  let toolCalls = 0;

  if (!response.body) {
    throw new Error("No response body from subagent stream");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (abortSignal.aborted) break;

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      
      // Process SSE events
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;

        try {
          const event = JSON.parse(data);

          // Handle text content
          if (event.type === "text" || event.type === "text-delta") {
            fullText += event.text || event.textDelta || "";
          }

          // Handle tool calls — execute them locally
          if (event.type === "tool-call") {
            toolCalls++;
            setToolCallCount(toolCalls);

            const toolName = event.toolName || event.name;
            const toolInput = event.args || event.input || {};

            // Enforce tool access control
            if (!config.allowedTools.includes(toolName)) {
              appendLog(logPath, {
                timestamp: new Date().toISOString(),
                agentId,
                type: agentType,
                event: "tool-blocked",
                data: { tool: toolName },
              });
              continue;
            }

            try {
              const result = await executeLocalTool(
                toolName,
                toolInput,
                config.isReadOnly ? "PLAN" : "BUILD",
              );
              
              // Track file changes
              if (["writeFile", "editFile", "searchReplace"].includes(toolName)) {
                const path = (toolInput as { path?: string }).path;
                if (path && !filesChanged.includes(path)) {
                  filesChanged.push(path);
                }
              }

              appendLog(logPath, {
                timestamp: new Date().toISOString(),
                agentId,
                type: agentType,
                event: "tool-executed",
                data: { tool: toolName, path: (toolInput as { path?: string }).path },
              });
            } catch (toolError) {
              const msg = toolError instanceof Error ? toolError.message : String(toolError);
              errors.push(`Tool ${toolName} failed: ${msg}`);
              appendLog(logPath, {
                timestamp: new Date().toISOString(),
                agentId,
                type: agentType,
                event: "tool-error",
                data: { tool: toolName, error: msg },
              });
            }
          }
        } catch {
          // Skip unparseable events
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return fullText || `Agent ${agentType} completed ${toolCalls} tool calls.`;
}

// ─── Orchestrator ───────────────────────────────────────────────────

// Global state for UI status tracking
let activeAgents: Map<string, { type: AgentTypeValue; status: string }> = new Map();

export function getActiveAgents(): Map<string, { type: AgentTypeValue; status: string }> {
  return activeAgents;
}

export class SubAgentOrchestrator {
  private sessionId: string;
  private model: string;
  private mode: string;
  private runtimeContext: SubAgentRuntimeContext;

  constructor(
    sessionId: string,
    model: string,
    mode: string,
    runtimeContext: SubAgentRuntimeContext = {},
  ) {
    this.sessionId = sessionId;
    this.model = model;
    this.mode = mode;
    this.runtimeContext = runtimeContext;
  }

  /**
   * Execute multiple subagents with controlled concurrency.
   * Uses Promise.allSettled for resilience — one failing agent doesn't kill others.
   */
  async execute(
    agents: SubAgentRequest[],
    maxConcurrent: number = 3,
  ): Promise<SubAgentResult[]> {
    ensureLogDir();

    const results: SubAgentResult[] = [];
    const queue = [...agents];
    const running: Promise<void>[] = [];

    console.error(`\n[subagent] Spawning ${agents.length} agent(s): ${agents.map(a => a.type).join(", ")}`);

    while (queue.length > 0 || running.length > 0) {
      // Fill up to maxConcurrent
      while (queue.length > 0 && running.length < maxConcurrent) {
        const agent = queue.shift()!;
        const config = AGENT_CONFIGS[agent.type];
        const agentId = generateAgentId(agent.type);
        const logPath = getLogPath(this.sessionId, agentId);

        // Set up timeout abort
        const abortController = new AbortController();
        const timeoutHandle = setTimeout(() => {
          abortController.abort();
        }, config.timeoutMs);

        // Track for UI
        activeAgents.set(agentId, { type: agent.type, status: "running" });
        console.error(`[subagent] > ${agent.type} agent started: "${agent.task.slice(0, 80)}..."`);

        const promise = executeSubAgent(
          agent,
          agentId,
          this.sessionId,
          this.model,
          this.mode,
          this.runtimeContext,
          logPath,
          abortController.signal,
        ).then((result) => {
          clearTimeout(timeoutHandle);
          results.push(result);
          activeAgents.set(agentId, { type: agent.type, status: result.status });
          
          const icon = result.status === "completed" ? "[OK]" : result.status === "timeout" ? "[TIMEOUT]" : "[FAIL]";
          console.error(`[subagent] ${icon} ${agent.type} agent ${result.status} (${Math.round(result.durationMs / 1000)}s, ${result.toolCallCount} tools)`);
        }).catch((error) => {
          clearTimeout(timeoutHandle);
          const msg = error instanceof Error ? error.message : String(error);
          results.push({
            agentId,
            type: agent.type,
            status: "failed",
            summary: `Agent crashed: ${msg}`,
            filesChanged: [],
            errors: [msg],
            durationMs: Date.now(),
            toolCallCount: 0,
          });
          activeAgents.set(agentId, { type: agent.type, status: "failed" });
          console.error(`[subagent] [FAIL] ${agent.type} agent crashed: ${msg}`);
        }).finally(() => {
          // Remove from running
          const idx = running.indexOf(promise);
          if (idx !== -1) running.splice(idx, 1);
        });

        running.push(promise);
      }

      // Wait for at least one to finish before continuing
      if (running.length > 0) {
        await Promise.race(running);
      }
    }

    // Clean up active agents tracking
    setTimeout(() => {
      for (const [id, agent] of activeAgents) {
        if (agent.status !== "running") {
          activeAgents.delete(id);
        }
      }
    }, 5000);

    console.error(`[subagent] All ${agents.length} agent(s) completed.\n`);

    return results;
  }

  /**
   * Format results into a structured summary for the parent AI.
   */
  formatResults(results: SubAgentResult[]): string {
    if (results.length === 0) {
      return "No subagents were executed.";
    }

    const sections: string[] = [];
    
    sections.push(`## SubAgent Results (${results.length} agent${results.length > 1 ? "s" : ""})\n`);

    for (const result of results) {
      const statusIcon = result.status === "completed" ? "[OK]" : result.status === "timeout" ? "[TIMEOUT]" : "[FAIL]";
      const duration = (result.durationMs / 1000).toFixed(1);

      sections.push(`### ${statusIcon} ${result.type} agent (${duration}s, ${result.toolCallCount} tool calls)`);
      sections.push(result.summary);

      if (result.filesChanged.length > 0) {
        sections.push(`\n**Files Changed:** ${result.filesChanged.map(f => `\`${f}\``).join(", ")}`);
      }

      if (result.errors.length > 0) {
        sections.push(`\n**Errors:** ${result.errors.join("; ")}`);
      }

      sections.push(""); // blank line separator
    }

    return sections.join("\n");
  }
}
