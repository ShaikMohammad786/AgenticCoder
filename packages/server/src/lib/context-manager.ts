/**
 * Context Window Manager — intelligent message trimming with token awareness.
 * 
 * Strategy:
 * 1. Always keep the system prompt + first user message (for context)
 * 2. Always keep the latest N messages (for recency)
 * 3. Summarize old messages when they exceed the budget
 * 4. Prioritize tool results and error messages (they contain critical state)
 */

import {
  estimateMessageTokens,
  estimateTokens,
  getTokenBudget,
  type TokenBudget,
} from "@agenticcoder/shared";

type Message = {
  id: string;
  role: string;
  parts?: Array<{ type: string; text?: string; [key: string]: unknown }>;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
};

export type ContextManagerResult = {
  messages: Message[];
  totalTokens: number;
  trimmedCount: number;
  summary: string | null;
  budget: TokenBudget;
};

/**
 * Manage context window by intelligently trimming messages to fit within token budget.
 */
export function manageContext(
  messages: Message[],
  systemPromptTokens: number,
  projectContextTokens: number,
  maxContextTokens: number = 16384,
): ContextManagerResult {
  const budget = getTokenBudget(maxContextTokens);

  // Calculate available budget for history after system prompt and project context
  const usedBySystem = systemPromptTokens + projectContextTokens;
  const availableForHistory = budget.maxContextTokens - usedBySystem - budget.reserveTokens;

  if (availableForHistory <= 0) {
    // Extreme case: system prompt alone exceeds budget
    return {
      messages: messages.slice(-2), // Keep only latest exchange
      totalTokens: usedBySystem,
      trimmedCount: Math.max(0, messages.length - 2),
      summary: null,
      budget,
    };
  }

  // Calculate token costs for each message
  const messageTokens = messages.map((msg) => ({
    message: msg,
    tokens: estimateMessageTokens(msg),
    priority: getMessagePriority(msg),
  }));

  const totalHistoryTokens = messageTokens.reduce((sum, m) => sum + m.tokens, 0);

  // If everything fits, no trimming needed
  if (totalHistoryTokens <= availableForHistory) {
    return {
      messages,
      totalTokens: usedBySystem + totalHistoryTokens,
      trimmedCount: 0,
      summary: null,
      budget,
    };
  }

  // Need to trim — apply priority-based strategy
  const result = priorityTrim(messageTokens, availableForHistory);

  return {
    messages: result.kept,
    totalTokens: usedBySystem + result.keptTokens,
    trimmedCount: result.droppedCount,
    summary: result.summary,
    budget,
  };
}

type ScoredMessage = {
  message: Message;
  tokens: number;
  priority: number;
};

function priorityTrim(
  scored: ScoredMessage[],
  budget: number,
): { kept: Message[]; keptTokens: number; droppedCount: number; summary: string | null } {
  if (scored.length === 0) {
    return { kept: [], keptTokens: 0, droppedCount: 0, summary: null };
  }

  // Always keep: first message (context) + last 6 messages (recency)
  const KEEP_FIRST = 1;
  const KEEP_LAST = 6;

  const first = scored.slice(0, KEEP_FIRST);
  const last = scored.slice(-KEEP_LAST);
  const middle = scored.slice(KEEP_FIRST, -KEEP_LAST);

  // Calculate mandatory token cost (first + last)
  const mandatoryTokens = [...first, ...last].reduce((sum, m) => sum + m.tokens, 0);

  if (mandatoryTokens >= budget) {
    // Even mandatory messages exceed budget — keep only last messages
    let keptTokens = 0;
    const kept: Message[] = [];
    for (let i = scored.length - 1; i >= 0; i--) {
      if (keptTokens + scored[i]!.tokens > budget) break;
      keptTokens += scored[i]!.tokens;
      kept.unshift(scored[i]!.message);
    }
    return {
      kept,
      keptTokens,
      droppedCount: scored.length - kept.length,
      summary: `(${scored.length - kept.length} older messages trimmed to fit context window)`,
    };
  }

  // Fill remaining budget with highest-priority middle messages
  const remainingBudget = budget - mandatoryTokens;
  const sortedMiddle = [...middle].sort((a, b) => b.priority - a.priority);

  let middleTokens = 0;
  const keptMiddle: ScoredMessage[] = [];

  for (const msg of sortedMiddle) {
    if (middleTokens + msg.tokens <= remainingBudget) {
      keptMiddle.push(msg);
      middleTokens += msg.tokens;
    }
  }

  // Reconstruct in original order
  const keptMiddleSet = new Set(keptMiddle.map((m) => m.message.id));
  const droppedCount = middle.length - keptMiddle.length;

  const kept: Message[] = [];
  let summary: string | null = null;

  // Add first message
  for (const m of first) kept.push(m.message);

  // Add summary of dropped messages
  if (droppedCount > 0) {
    summary = buildSummary(middle.filter((m) => !keptMiddleSet.has(m.message.id)));
    // Inject summary as a system-style message
    kept.push({
      id: "__context_summary__",
      role: "assistant",
      parts: [{
        type: "text",
        text: `[Context summary: ${summary}]`,
      }],
    });
  }

  // Add kept middle messages in original order
  for (const m of middle) {
    if (keptMiddleSet.has(m.message.id)) {
      kept.push(m.message);
    }
  }

  // Add last messages
  for (const m of last) kept.push(m.message);

  return {
    kept,
    keptTokens: mandatoryTokens + middleTokens + (summary ? estimateTokens(summary) : 0),
    droppedCount,
    summary,
  };
}

/**
 * Assign priority score to a message (higher = more important to keep).
 */
function getMessagePriority(message: Message): number {
  let score = 0;
  const parts = message.parts ?? [];

  // User messages are important (they contain instructions)
  if (message.role === "user") score += 30;

  // Assistant messages with tool calls are important (they show what was done)
  if (message.role === "assistant") score += 10;

  for (const part of parts) {
    // Error results are critical (prevent repeating mistakes)
    if (part.type === "tool-result" && part.state === "output-error") {
      score += 50;
    }
    // Successful tool results with file changes are important
    if (part.type === "tool-result" && part.toolName) {
      const writeTool = ["writeFile", "editFile", "searchReplace", "bash"];
      if (writeTool.includes(part.toolName as string)) {
        score += 25;
      }
    }
    // Text content length — longer = more context
    if (part.type === "text" && part.text) {
      score += Math.min(20, (part.text as string).length / 100);
    }
  }

  return score;
}

/**
 * Build a brief summary of dropped messages.
 */
function buildSummary(dropped: ScoredMessage[]): string {
  const toolCalls = new Set<string>();
  const filesMentioned = new Set<string>();
  let userQuestions = 0;

  for (const { message } of dropped) {
    if (message.role === "user") userQuestions++;
    for (const part of (message.parts ?? [])) {
      if (part.toolName) toolCalls.add(part.toolName as string);
      if (part.type === "tool-result") {
        const output = part.output ?? part.result;
        if (output && typeof output === "object" && "path" in (output as object)) {
          filesMentioned.add((output as { path: string }).path);
        }
      }
    }
  }

  const parts: string[] = [];
  parts.push(`${dropped.length} messages compressed`);
  if (userQuestions > 0) parts.push(`${userQuestions} user questions`);
  if (toolCalls.size > 0) parts.push(`tools used: ${[...toolCalls].join(", ")}`);
  if (filesMentioned.size > 0) {
    const files = [...filesMentioned].slice(0, 5);
    parts.push(`files: ${files.join(", ")}${filesMentioned.size > 5 ? ` +${filesMentioned.size - 5} more` : ""}`);
  }

  return parts.join(". ");
}
