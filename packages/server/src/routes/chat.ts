import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import {
  convertToModelMessages,
  streamText,
  validateUIMessages,
  type InferUITools,
  type LanguageModelUsage,
  type UIMessage,
} from "ai";
import { db } from "@agenticcoder/database/client";
import type { Prisma } from "@agenticcoder/database";
import { 
  getToolContracts, 
  modeSchema, 
  agentTypeSchema,
  type ModeType, 
  type ToolContracts
} from "@agenticcoder/shared";
import { buildSystemPrompt } from "../system-prompts";
import type { AuthenticatedRequest } from "../middleware/require-auth";
import { requireCreditsBalance } from "../middleware/require-credits-balance";
import { calculateCreditsForUsage, isZeroPricedModel } from "../lib/credits";
import { ingestAiUsage } from "../lib/polar";
import { isSupportedChatModel, resolveChatModel } from "../lib/models";
import { estimateTokens } from "@agenticcoder/shared";
import { manageContext } from "../lib/context-manager";

type ChatMessageMetadata = {
  mode?: ModeType;
  model?: string;
  durationMs?: number;
  usage?: LanguageModelUsage;
};

type agenticcoderUIMessage = UIMessage<ChatMessageMetadata, never, InferUITools<ToolContracts>>;

const messageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  parts: z.array(z.record(z.unknown())),
  metadata: z.record(z.unknown()).optional(),
});

const submitSchema = z.object({
  id: z.string(),
  messages: z.array(messageSchema),
  mode: modeSchema,
  model: z.string(),
  projectContext: z.string().optional(),
  mcpTools: z.array(z.object({
    name: z.string(),
    description: z.string(),
    inputSchema: z.record(z.unknown()),
  })).optional(),
  memories: z.string().optional(),
});

function hasPendingToolCalls(message: agenticcoderUIMessage) {
  return message.parts.some((part) => {
    if (part.type === "dynamic-tool" || part.type.startsWith("tool-")) {
      const state = (part as { state?: string }).state;
      return state !== "output-available" && state !== "output-error";
    }

    return false;
  });
};

// ── Simple in-memory rate limiter ────────────────────────────────
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 10; // 10 requests per minute per user
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(userId);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  entry.count++;
  return entry.count <= RATE_LIMIT_MAX;
}

// Clean up stale rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(key);
  }
}, 300_000);

const router = Router();

router.post(
  "/",
  requireCreditsBalance,
  async (req: Request, res: Response) => {
    try {
      const userId = (req as AuthenticatedRequest).userId;

      // Rate limiting
      if (!checkRateLimit(userId)) {
        res.status(429).json({ error: "Too many requests. Please slow down." });
        return;
      }

      // Validate request body
      const parsed = submitSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid request body" });
        return;
      }

      const { id, messages, mode, model, projectContext, mcpTools, memories } = parsed.data;

      const session = await db.session.findUnique({
        where: { id, userId },
      });

      if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
      }

      const startTime = Date.now();
      const builtInTools = getToolContracts(mode);

      // Merge MCP tools with built-in tools for the AI
      const allTools: Record<string, any> = { ...builtInTools };
      if (mcpTools && mcpTools.length > 0) {
        for (const mcpTool of mcpTools) {
          allTools[mcpTool.name] = {
            description: mcpTool.description,
            parameters: mcpTool.inputSchema,
          };
        }
      }
      const resolvedModel = resolveChatModel(model);
      const previousMessages = Array.isArray(session.messages)
        ? (session.messages as unknown as agenticcoderUIMessage[])
        : [];
      const mergedMessages = [...previousMessages];
      
      for (const message of messages) {
        const incomingMessage = {
          ...message,
          metadata: { ...message.metadata, mode, model },
        } satisfies agenticcoderUIMessage;

        const existingMessageIndex = mergedMessages.findIndex((m) => m.id === incomingMessage.id);

        if (existingMessageIndex === -1) {
          mergedMessages.push(incomingMessage);
        } else {
          mergedMessages[existingMessageIndex] = incomingMessage;
        }
      }

      // Filter out corrupted messages (e.g. empty assistant replies from failed streams)
      const validMessages = mergedMessages.filter(
        (m) => m.id && Array.isArray(m.parts) && m.parts.length > 0
      );

      // Build system prompt with memories
      const systemPromptBase = buildSystemPrompt({ mode, hasImages: false });
      const fullSystemPrompt = systemPromptBase
        + (memories ? "\n" + memories : "")
        + (projectContext ? "\n\n" + projectContext : "");

      // Token-aware context window management
      const systemTokens = estimateTokens(fullSystemPrompt);
      const projectTokens = projectContext ? estimateTokens(projectContext) : 0;
      const contextResult = manageContext(
        validMessages as any[],
        systemTokens,
        projectTokens,
        32768, // Most free models support 32K+ context
      );
      const trimmedMessages = contextResult.messages as agenticcoderUIMessage[];

      // Validate/convert with the full tool set so dynamic MCP/plugin tool
      // results are preserved when the client sends the next step.
      const nextMessages = await validateUIMessages<agenticcoderUIMessage>({
        messages: trimmedMessages,
        tools: allTools,
      });
      const modelMessages = await convertToModelMessages(nextMessages, { tools: allTools });
      let completedUsage: LanguageModelUsage | null = null;

      console.log(`[chat] session=${id} model=${model} mode=${mode} msgs=${validMessages.length}${contextResult.trimmedCount > 0 ? ` (trimmed ${contextResult.trimmedCount}, ~${contextResult.totalTokens} tokens)` : ''} budget=${contextResult.budget.maxContextTokens}`);

      // Request timeout — abort if AI takes longer than 120s
      const abortController = new AbortController();
      const requestTimeout = setTimeout(() => abortController.abort(), 120_000);

      const hasImages = trimmedMessages.some((m) =>
        m.parts?.some((p: any) => p.type === "file" && p.mediaType?.startsWith("image/"))
        || (m as any).experimental_attachments?.length > 0
      );

      const result = streamText({
        model: resolvedModel.model,
        system: fullSystemPrompt,
        messages: modelMessages,
        tools: allTools,
        maxSteps: 25,
        maxTokens: 16384,
        temperature: 0,
        toolCallStreaming: true,
        abortSignal: abortController.signal,
        ...(resolvedModel.provider === "openrouter" ? {
          providerOptions: {
            openrouter: {
              transforms: ["middle-out"],
            },
          },
        } : {}),
        onFinish(event) {
          clearTimeout(requestTimeout);
          completedUsage = event.totalUsage;
        },
      });

      // Convert AI SDK stream response to a Web Response
      const webResponse = result.toUIMessageStreamResponse<agenticcoderUIMessage>({
        originalMessages: nextMessages,
        messageMetadata({ part }) {
          if (part.type === "start") {
            return { mode, model };
          }

          if (part.type !== "finish") return undefined;

          return {
            mode,
            model,
            durationMs: Date.now() - startTime,
            ...(completedUsage ? { usage: completedUsage } : {}),
          };
        },
        async onFinish(event) {
          // Save messages on abort too (prevents data loss on Esc)
          if (event.isAborted) {
            try {
              await db.session.update({
                where: { id, userId },
                data: {
                  messages: event.messages as unknown as Prisma.InputJsonValue,
                },
              });
            } catch (e) {
              console.error("Failed to save aborted session:", e);
            }
            return;
          }

          if (hasPendingToolCalls(event.responseMessage)) return;

          // Save session with retry for transient DB errors
          try {
            await db.session.update({
              where: { id, userId },
              data: {
                messages: event.messages as unknown as Prisma.InputJsonValue,
              },
            });
          } catch (saveError) {
            console.error("Session save failed, retrying once:", saveError);
            try {
              await db.session.update({
                where: { id, userId },
                data: {
                  messages: event.messages as unknown as Prisma.InputJsonValue,
                },
              });
            } catch (retryError) {
              console.error("Session save retry also failed:", retryError);
            }
          }

          if (!completedUsage) return;

          // Skip billing for local models (Ollama)
          if (resolvedModel.isLocal) return;

          // Skip billing only for explicit free catalog models.
          if (isZeroPricedModel(resolvedModel.modelId)) {
            return;
          }

          try {
            const billableUsage = calculateCreditsForUsage({
              provider: resolvedModel.provider,
              model: resolvedModel.modelId,
              usage: completedUsage,
            });

            await ingestAiUsage({
              externalCustomerId: userId,
              eventId: `chat-message:${event.responseMessage.id}`,
              credits: billableUsage.credits,
            });
          } catch (error) {
            console.error("Failed to ingest Polar AI usage for chat message", {
              error,
              sessionId: id,
              messageId: event.responseMessage.id,
              userId,
            });
          }
        },
        onError(error) {
          return error instanceof Error ? error.message : String(error);
        },
      });

      // Pipe the Web Response body (ReadableStream) to Express response
      res.status(webResponse.status);
      webResponse.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });

      if (webResponse.body) {
        const reader = webResponse.body.getReader();
        const pump = async () => {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              res.end();
              break;
            }
            res.write(value);
          }
        };

        // Handle client disconnect
        req.on("close", () => {
          reader.cancel();
        });

        await pump();
      } else {
        res.end();
      }
    } catch (error) {
      console.error("Chat route error:", error);
      const message = error instanceof Error ? error.message : "Failed to process chat request";
      if (!res.headersSent) {
        res.status(500).json({ error: message });
      }
    }
  },
);

// ─── SubAgent Endpoint ──────────────────────────────────────────────
// Handles isolated subagent conversations with custom system prompts,
// constrained tools, and no billing (bundled into parent request).

const subAgentSchema = z.object({
  sessionId: z.string(),
  agentId: z.string(),
  agentType: agentTypeSchema,
  model: z.string(),
  mode: modeSchema,
  systemPrompt: z.string(),
  userMessage: z.string(),
  maxSteps: z.number().min(1).max(30).default(15),
  allowedTools: z.array(z.string()),
  externalTools: z.array(z.object({
    name: z.string(),
    description: z.string().optional(),
    inputSchema: z.record(z.unknown()).optional(),
  })).optional(),
  messages: z.array(messageSchema).optional(),
});

router.post(
  "/subagent",
  async (req: Request, res: Response) => {
    try {
      const userId = (req as AuthenticatedRequest).userId;
      const parsed = subAgentSchema.safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({ error: "Invalid subagent request body" });
        return;
      }

      const {
        sessionId, agentId, agentType, model, mode,
        systemPrompt, userMessage, maxSteps, allowedTools, externalTools, messages,
      } = parsed.data;

      console.log(`[subagent] session=${sessionId} agent=${agentId} type=${agentType} model=${model} maxSteps=${maxSteps}`);

      const resolvedModel = resolveChatModel(model);

      // Build tool contracts filtered by allowed tools
      const allTools = getToolContracts(mode);
      const filteredTools: Record<string, any> = {};
      for (const [name, contract] of Object.entries(allTools)) {
        if (allowedTools.includes(name)) {
          filteredTools[name] = contract;
        }
      }
      for (const externalTool of externalTools ?? []) {
        if (allowedTools.includes(externalTool.name)) {
          filteredTools[externalTool.name] = {
            description: externalTool.description ?? `[External] ${externalTool.name}`,
            parameters: externalTool.inputSchema ?? {},
          };
        }
      }

      // Build messages — single user message for the subagent
      const subAgentMessages: agenticcoderUIMessage[] = messages?.length
        ? messages as agenticcoderUIMessage[]
        : [
            {
              id: `subagent-${agentId}-msg`,
              role: "user",
              parts: [{ type: "text", text: userMessage }],
            },
          ];

      const nextMessages = await validateUIMessages<agenticcoderUIMessage>({
        messages: subAgentMessages,
        tools: filteredTools as any,
      });
      const modelMessages = await convertToModelMessages(nextMessages, { tools: filteredTools as any });

      // Abort after timeout
      const abortController = new AbortController();
      const requestTimeout = setTimeout(() => abortController.abort(), 120_000);

      const result = streamText({
        model: resolvedModel.model,
        system: systemPrompt,
        messages: modelMessages,
        tools: filteredTools,
        maxSteps,
        maxTokens: 8192, // Reduced for subagents
        temperature: 0,
        toolCallStreaming: true,
        abortSignal: abortController.signal,
        onFinish() {
          clearTimeout(requestTimeout);
        },
      });

      // Stream the response back
      const webResponse = result.toUIMessageStreamResponse<agenticcoderUIMessage>({
        originalMessages: nextMessages,
        onError(error) {
          return error instanceof Error ? error.message : String(error);
        },
      });

      // Pipe Web Response to Express
      res.status(webResponse.status);
      res.setHeader("X-Agent-Type", agentType);
      res.setHeader("X-Agent-Id", agentId);
      webResponse.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });

      if (webResponse.body) {
        const reader = webResponse.body.getReader();
        const pump = async () => {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              res.end();
              break;
            }
            res.write(value);
          }
        };

        req.on("close", () => {
          reader.cancel();
        });

        await pump();
      } else {
        res.end();
      }
    } catch (error) {
      console.error("SubAgent route error:", error);
      const message = error instanceof Error ? error.message : "Failed to process subagent request";
      if (!res.headersSent) {
        res.status(500).json({ error: message });
      }
    }
  },
);

export default router;
