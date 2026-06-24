/**
 * Token counting utilities for context window management.
 * Uses character-based estimation (no external dependency).
 * 
 * Estimation rationale:
 * - English text: ~4 chars per token (GPT/Claude)
 * - Code: ~3.5 chars per token (more symbols)
 * - JSON/structured: ~3 chars per token
 * We use 3.5 as a conservative middle ground.
 */

const CHARS_PER_TOKEN = 3.5;

/**
 * Estimate token count from a string.
 * Fast O(1) estimation based on character count.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Estimate tokens for a message object (role + parts).
 */
export function estimateMessageTokens(message: {
  role: string;
  parts?: Array<{ type: string; text?: string; [key: string]: unknown }>;
  content?: string;
}): number {
  let total = 4; // Base overhead for message structure (role, separators)
  
  if (message.content) {
    total += estimateTokens(message.content);
  }

  if (message.parts) {
    for (const part of message.parts) {
      if (part.type === "text" && part.text) {
        total += estimateTokens(part.text);
      } else if (part.type === "tool-invocation" || part.type === "tool-result") {
        // Tool calls/results are typically JSON-serialized
        total += estimateTokens(JSON.stringify(part));
      }
    }
  }

  return total;
}

/**
 * Token budget configuration for different model context sizes.
 */
export type TokenBudget = {
  maxContextTokens: number;
  systemPromptBudget: number;
  projectContextBudget: number;
  historyBudget: number;
  reserveTokens: number; // Buffer for response generation
};

/**
 * Get default token budget for a given model's context size.
 */
export function getTokenBudget(maxContextTokens: number = 16384): TokenBudget {
  return {
    maxContextTokens,
    systemPromptBudget: Math.floor(maxContextTokens * 0.15),     // 15% for system prompt
    projectContextBudget: Math.floor(maxContextTokens * 0.10),   // 10% for AGENT.md + context
    historyBudget: Math.floor(maxContextTokens * 0.55),          // 55% for conversation history
    reserveTokens: Math.floor(maxContextTokens * 0.20),          // 20% for AI response
  };
}

/**
 * Format token count for display.
 */
export function formatTokenCount(tokens: number): string {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
  return String(tokens);
}

/**
 * Calculate fill percentage of context window.
 */
export function contextFillPercent(usedTokens: number, maxTokens: number): number {
  return Math.min(100, Math.round((usedTokens / maxTokens) * 100));
}
