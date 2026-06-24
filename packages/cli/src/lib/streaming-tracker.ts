/**
 * Streaming Progress Tracker
 *
 * Tracks real-time metrics during AI response streaming:
 * - Tokens per second (tok/s)
 * - Total tokens generated
 * - Elapsed time
 * - Estimated cost
 * 
 * Used by the status bar to show live streaming indicators.
 */

import { estimateTokens, formatTokenCount } from "@agenticcoder/shared";

export type StreamMetrics = {
  tokensGenerated: number;
  tokensPerSecond: number;
  elapsedMs: number;
  estimatedCost: number;
  isStreaming: boolean;
  firstTokenMs: number | null; // Time to first token (TTFT)
};

export class StreamingTracker {
  private startTime: number = 0;
  private firstTokenTime: number | null = null;
  private totalChars: number = 0;
  private chunkTimestamps: number[] = [];
  private _isStreaming: boolean = false;
  private inputTokens: number = 0;
  private costPerMillionInput: number = 0;
  private costPerMillionOutput: number = 0;

  /**
   * Start tracking a new streaming response.
   */
  start(inputTokenEstimate: number = 0, pricing?: { input: number; output: number }): void {
    this.startTime = Date.now();
    this.firstTokenTime = null;
    this.totalChars = 0;
    this.chunkTimestamps = [];
    this._isStreaming = true;
    this.inputTokens = inputTokenEstimate;
    this.costPerMillionInput = pricing?.input ?? 0;
    this.costPerMillionOutput = pricing?.output ?? 0;
  }

  /**
   * Record a streaming chunk.
   */
  onChunk(text: string): void {
    if (!this._isStreaming) return;

    const now = Date.now();

    if (this.firstTokenTime === null) {
      this.firstTokenTime = now;
    }

    this.totalChars += text.length;
    this.chunkTimestamps.push(now);

    // Keep only last 50 timestamps for rolling average
    if (this.chunkTimestamps.length > 50) {
      this.chunkTimestamps = this.chunkTimestamps.slice(-50);
    }
  }

  /**
   * Stop tracking.
   */
  stop(): void {
    this._isStreaming = false;
  }

  /**
   * Get current metrics snapshot.
   */
  getMetrics(): StreamMetrics {
    const now = Date.now();
    const elapsedMs = now - this.startTime;
    const tokensGenerated = estimateTokens(
      "x".repeat(this.totalChars), // Quick estimate from char count
    );

    // Calculate tokens/second from rolling window
    let tokensPerSecond = 0;
    if (this.chunkTimestamps.length >= 2) {
      const windowStart = this.chunkTimestamps[0]!;
      const windowEnd = this.chunkTimestamps[this.chunkTimestamps.length - 1]!;
      const windowMs = windowEnd - windowStart;

      if (windowMs > 0) {
        // Estimate tokens in the window
        const windowTokens = Math.round(tokensGenerated * (this.chunkTimestamps.length / Math.max(1, this.chunkTimestamps.length)));
        tokensPerSecond = Math.round((windowTokens / windowMs) * 1000);
      }
    }

    // Calculate estimated cost
    const inputCost = (this.inputTokens / 1_000_000) * this.costPerMillionInput;
    const outputCost = (tokensGenerated / 1_000_000) * this.costPerMillionOutput;
    const estimatedCost = inputCost + outputCost;

    return {
      tokensGenerated,
      tokensPerSecond: Math.max(0, tokensPerSecond),
      elapsedMs,
      estimatedCost,
      isStreaming: this._isStreaming,
      firstTokenMs: this.firstTokenTime ? this.firstTokenTime - this.startTime : null,
    };
  }

  /**
   * Format metrics as a compact status string for the status bar.
   */
  formatStatus(): string {
    const m = this.getMetrics();

    if (!m.isStreaming && m.tokensGenerated === 0) return "";

    const parts: string[] = [];

    // Tokens per second
    if (m.tokensPerSecond > 0) {
      parts.push(`⚡ ${m.tokensPerSecond} tok/s`);
    }

    // Elapsed time
    const secs = (m.elapsedMs / 1000).toFixed(1);
    parts.push(`⏱ ${secs}s`);

    // Token count
    parts.push(`📊 ${formatTokenCount(m.tokensGenerated)}`);

    // Cost (only show if > 0)
    if (m.estimatedCost > 0.0001) {
      parts.push(`💰 $${m.estimatedCost.toFixed(4)}`);
    }

    // Time to first token (only while streaming)
    if (m.isStreaming && m.firstTokenMs !== null) {
      parts.push(`TTFT: ${m.firstTokenMs}ms`);
    }

    return parts.join("  │  ");
  }
}

// Singleton tracker instance
let _tracker: StreamingTracker | null = null;

export function getStreamingTracker(): StreamingTracker {
  if (!_tracker) {
    _tracker = new StreamingTracker();
  }
  return _tracker;
}
