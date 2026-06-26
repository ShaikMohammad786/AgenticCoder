import { mkdirSync, appendFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { AgentTypeValue } from "@agenticcoder/shared";
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
  sessionId: string,
  parentModel: string,
  parentMode: string,
  logPath: string,
  abortSignal: AbortSignal,
): Promise<SubAgentResult> {
  const agentId = generateAgentId(request.type);
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
    const systemPrompt = buildSubAgentPrompt(request, config);

    // Build the initial user message for the subagent
    const userMessage = buildSubAgentUserMessage(request);

    // Stream conversation with the AI via the subagent endpoint
    const response = await fetchSubAgentStream({
      sessionId,
      agentId,
      agentType: request.type,
      model: parentModel,
      mode: parentMode,
      systemPrompt,
      userMessage,
      config,
      abortSignal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(`Subagent API error (${response.status}): ${errorText}`);
    }

    // Process the streaming response
    const result = await processSubAgentStream(
      response,
      agentId,
      request.type,
      config,
      logPath,
      abortSignal,
      filesChanged,
      errors,
      (count) => { toolCallCount = count; },
    );

    finalSummary = result;

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

function buildSubAgentPrompt(request: SubAgentRequest, config: AgentConfig): string {
  const basePrompt = AGENT_SYSTEM_PROMPTS[request.type];
  
  const toolList = config.allowedTools.map(t => `- **${t}**`).join("\n");
  
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

  return `${basePrompt}\n\n## Available Tools\n${toolList}\n\n${constraints}`;
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
      allowedTools: opts.config.allowedTools,
    }),
    signal: opts.abortSignal,
  });
}

// ─── Stream Processing ──────────────────────────────────────────────

async function processSubAgentStream(
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
              const result = await executeLocalTool(toolName, toolInput);
              
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

  constructor(sessionId: string, model: string, mode: string) {
    this.sessionId = sessionId;
    this.model = model;
    this.mode = mode;
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
        const agentId = `${agent.type}-${Date.now().toString(36)}`;
        const logPath = getLogPath(this.sessionId, agentId);

        // Set up timeout abort
        const abortController = new AbortController();
        const timeoutHandle = setTimeout(() => {
          abortController.abort();
        }, config.timeoutMs);

        // Track for UI
        activeAgents.set(agentId, { type: agent.type, status: "running" });
        console.error(`[subagent] ▶ ${agent.type} agent started: "${agent.task.slice(0, 80)}..."`);

        const promise = executeSubAgent(
          agent,
          this.sessionId,
          this.model,
          this.mode,
          logPath,
          abortController.signal,
        ).then((result) => {
          clearTimeout(timeoutHandle);
          results.push(result);
          activeAgents.set(agentId, { type: agent.type, status: result.status });
          
          const icon = result.status === "completed" ? "✓" : result.status === "timeout" ? "⏱" : "✗";
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
          console.error(`[subagent] ✗ ${agent.type} agent crashed: ${msg}`);
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
      const statusIcon = result.status === "completed" ? "✅" : result.status === "timeout" ? "⏱️" : "❌";
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
