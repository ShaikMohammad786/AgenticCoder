import { useMemo, useRef, useEffect, useCallback, useState } from "react";
import { useChat as useAiChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  type InferUITools,
  lastAssistantMessageIsCompleteWithToolCalls,
  type LanguageModelUsage,
  type UIMessage,
} from "ai";
import { type ModeType, type SupportedChatModelId, type ToolContracts } from "@agenticcoder/shared";
import { apiClient } from "../lib/api-client";
import { getAuth } from "../lib/auth";
import { executeLocalTool } from "../lib/local-tools";
import { buildProjectContext } from "../lib/project-context";
import { extractImageMentions } from "../lib/image-input";
import { initializeMcp, getAllMcpTools, hasMcpConfig } from "../lib/mcp-client";

export type ChatMessageMetadata = {
  mode?: ModeType;
  model?: SupportedChatModelId | string;
  durationMs?: number;
  usage?: LanguageModelUsage;
};

type ChatTools = {
  [Name in keyof InferUITools<ToolContracts>]: {
    input: InferUITools<ToolContracts>[Name]["input"];
    output: unknown;
  };
};

export type Message = UIMessage<ChatMessageMetadata, never, ChatTools>;

export function useChat(sessionId: string, initialMessages: Message[]) {
  // Cache project context so we only detect once per session
  const projectContextRef = useRef<string | null>(null);
  const projectContextLoadedRef = useRef(false);

  // MCP tools cache
  const mcpToolsRef = useRef<ReturnType<typeof getAllMcpTools> | null>(null);
  const mcpInitializedRef = useRef(false);

  // Bash streaming state (local to session, no provider needed)
  const [bashOutput, setBashOutput] = useState("");
  const [isBashStreaming, setIsBashStreaming] = useState(false);
  const bashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onBashOutput = useCallback((chunk: string) => {
    setIsBashStreaming(true);
    setBashOutput((prev) => {
      const combined = prev + chunk;
      const lines = combined.split("\n");
      return lines.length > 100 ? lines.slice(-100).join("\n") : combined;
    });
    if (bashTimeoutRef.current) clearTimeout(bashTimeoutRef.current);
    bashTimeoutRef.current = setTimeout(() => setIsBashStreaming(false), 500);
  }, []);

  useEffect(() => {
    if (!projectContextLoadedRef.current) {
      projectContextLoadedRef.current = true;
      buildProjectContext().then((ctx) => {
        projectContextRef.current = ctx;
      });
    }
    // Initialize MCP lazily if config exists (with timeout so it never blocks chat)
    if (!mcpInitializedRef.current && hasMcpConfig()) {
      mcpInitializedRef.current = true;
      Promise.race([
        initializeMcp(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 10000)),
      ]).then(() => {
        mcpToolsRef.current = getAllMcpTools();
      }).catch(() => {});
    }
  }, []);

  const transport = useMemo(() => {
    return new DefaultChatTransport<Message>({
      api: apiClient.chat.$url().toString(),
      headers() {
        const auth = getAuth();
        return auth ? { Authorization: `Bearer ${auth.token}` } : new Headers();
      },
      prepareSendMessagesRequest({ messages }) {
        const message = messages[messages.length - 1];
        if (!message) throw new Error("No message to send");

        const metadata = messages.findLast(
          (m) => m.metadata?.mode && m.metadata?.model,
        )?.metadata;
        const previousMessage = messages[messages.length - 2];
        const requestMessages =
          message.role === "assistant" && previousMessage?.role === "user"
            ? [previousMessage, message]
            : [message];

        // Build MCP tool definitions for the server
        const mcpTools = mcpToolsRef.current?.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })) ?? [];

        return {
          body: {
            id: sessionId,
            messages: requestMessages,
            mode: message.metadata?.mode ?? metadata?.mode,
            model: message.metadata?.model ?? metadata?.model,
            // Send project context (AGENT.md + detected framework info)
            projectContext: projectContextRef.current ?? undefined,
            // Send MCP tool definitions so server can expose them to AI
            mcpTools: mcpTools.length > 0 ? mcpTools : undefined,
          },
        }
      }
    });
  }, [sessionId]);

  const chat = useAiChat<Message>({
    id: sessionId,
    messages: initialMessages,
    transport,
    async onToolCall({ toolCall }) {
      const mode = chat.messages.at(-1)?.metadata?.mode ?? "BUILD";
      const MAX_RETRIES = 1;

      // Clear bash output when a new bash command starts
      if (toolCall.toolName === "bash") {
        setBashOutput("");
      }

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const output = await executeLocalTool(
            toolCall.toolName,
            toolCall.input,
            mode,
            { onBashOutput },
          );
          chat.addToolOutput({
            tool: toolCall.toolName as keyof ChatTools,
            toolCallId: toolCall.toolCallId,
            output,
          });
          return;
        } catch (error) {
          // On last attempt, report the error
          if (attempt === MAX_RETRIES) {
            const errorText = error instanceof Error ? error.message : String(error);
            chat.addToolOutput({
              tool: toolCall.toolName as keyof ChatTools,
              toolCallId: toolCall.toolCallId,
              state: "output-error",
              errorText,
            });
          }
          // Otherwise retry silently
        }
      }
    },
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
  });

  return {
    messages: chat.messages,
    status: chat.status,
    error: chat.error,
    bashOutput,
    isBashStreaming,
    submit: async (params: { userText: string; mode: ModeType; model: SupportedChatModelId }) => {
      // Extract image mentions (@file.png) and convert to multimodal parts
      const { text, images } = await extractImageMentions(params.userText);

      if (images.length > 0) {
        return chat.sendMessage({
          text,
          metadata: {
            mode: params.mode,
            model: params.model,
          },
          experimental_attachments: images.map((img) => ({
            name: img.path,
            contentType: img.mimeType,
            url: `data:${img.mimeType};base64,${img.base64}`,
          })),
        });
      }

      return chat.sendMessage({
        text: params.userText,
        metadata: {
          mode: params.mode,
          model: params.model,
        },
      });
    },
    abort: chat.stop,
    interrupt: chat.stop,
  };
};