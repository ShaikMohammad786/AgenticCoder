import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
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
  type ModeType, 
  type ToolContracts
} from "@agenticcoder/shared";
import { buildSystemPrompt } from "../system-prompts";
import type { AuthenticatedEnv } from "../middleware/require-auth";
import { requireCreditsBalance } from "../middleware/require-credits-balance";
import { calculateCreditsForUsage } from "../lib/credits";
import { ingestAiUsage } from "../lib/polar";
import { isSupportedChatModel, resolveChatModel } from "../lib/models";
import { findSupportedChatModel } from "@agenticcoder/shared";

type ChatMessageMetadata = {
  mode?: ModeType;
  model?: string;
  durationMs?: number;
  usage?: LanguageModelUsage;
};

type agenticcoderUIMessage = UIMessage<ChatMessageMetadata, never, InferUITools<ToolContracts>>;

const submitSchema = z.object({
  id: z.string(),
  messages: z
    .array(
      z.custom<agenticcoderUIMessage>((value) => {
        return value != null && typeof value === "object" && "id" in value && "parts" in value;
      }),
    )
    .min(1),
  mode: modeSchema,
  model: z.string().refine(isSupportedChatModel, "Unsupported model"),
  projectContext: z.string().optional(),
  mcpTools: z.array(z.object({
    name: z.string(),
    description: z.string(),
    inputSchema: z.record(z.unknown()),
  })).optional(),
});

const submitValidator = zValidator("json", submitSchema, (result, c) => {
  if (!result.success) {
    return c.json({ error: "Invalid request body" }, 400);
  }
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

const app = new Hono<AuthenticatedEnv>()
  .post(
    "/",
    requireCreditsBalance,
    submitValidator,
    async (c) => {
      try {
        const userId = c.get("userId");
        const { id, messages, mode, model, projectContext, mcpTools } = c.req.valid("json");

        const session = await db.session.findUnique({
          where: { id, userId },
        });

        if (!session) {
          return c.json({ error: "Session not found" }, 404);
        }

        const startTime = Date.now();
        const builtInTools = getToolContracts(mode);

        // Merge MCP tools with built-in tools
        const tools: Record<string, any> = { ...builtInTools };
        if (mcpTools && mcpTools.length > 0) {
          for (const mcpTool of mcpTools) {
            tools[mcpTool.name] = {
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

        // Context window trimming — keep only the latest N messages to prevent
        // exceeding model context limits on long conversations.
        // Always include the first user message for context, then the latest messages.
        const MAX_CONTEXT_MESSAGES = 50;
        let trimmedMessages = validMessages;
        if (validMessages.length > MAX_CONTEXT_MESSAGES) {
          const first = validMessages[0];
          const latest = validMessages.slice(-MAX_CONTEXT_MESSAGES + 1);
          trimmedMessages = first ? [first, ...latest] : latest;
        }

        const nextMessages = await validateUIMessages<agenticcoderUIMessage>({
          messages: trimmedMessages,
          tools,
        });
        const modelMessages = await convertToModelMessages(nextMessages, { tools });
        let completedUsage: LanguageModelUsage | null = null;

        console.log(`[chat] session=${id} model=${model} mode=${mode} msgs=${validMessages.length}${validMessages.length > MAX_CONTEXT_MESSAGES ? ` (trimmed to ${trimmedMessages.length})` : ''}`);

        // Request timeout — abort if AI takes longer than 120s
        const abortController = new AbortController();
        const requestTimeout = setTimeout(() => abortController.abort(), 120_000);

        const result = streamText({
          model: resolvedModel.model,
          system: buildSystemPrompt({ mode }) + (projectContext ? "\n\n" + projectContext : ""),
          messages: modelMessages,
          tools,
          maxSteps: 25,
          maxTokens: 16384,
          temperature: 0,
          toolCallStreaming: true,
          abortSignal: abortController.signal,
          providerOptions: {
            openrouter: {
              transforms: ["middle-out"],
            },
          },
          onFinish(event) {
            clearTimeout(requestTimeout);
            completedUsage = event.totalUsage;
          },
        });

        return result.toUIMessageStreamResponse<agenticcoderUIMessage>({
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

            await db.session.update({
              where: { id, userId },
              data: {
                messages: event.messages as unknown as Prisma.InputJsonValue,
              },
            });

            if (!completedUsage) return;

            // Skip billing for free models (all pricing is $0)
            const pricing = findSupportedChatModel(resolvedModel.modelId)?.pricing;
            if (pricing && pricing.inputUsdPerMillionTokens === 0 && pricing.outputUsdPerMillionTokens === 0) {
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
      } catch (error) {
        console.error("Chat route error:", error);
        const message = error instanceof Error ? error.message : "Failed to process chat request";
        return c.json({ error: message }, 500);
      }
    },
  );

export default app;