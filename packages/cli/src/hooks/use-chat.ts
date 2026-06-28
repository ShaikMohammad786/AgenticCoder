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
import { loadPlugins, pluginsToToolDefinitions, type Plugin } from "../lib/plugins";
import { retrieveRelevantMemories, extractLearnings, saveMemories, formatMemoriesForPrompt } from "../lib/memory";
import { getStreamingTracker, type StreamMetrics } from "../lib/streaming-tracker";
import { formatErrorMessage } from "../lib/error-message";

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

function hasVisibleAssistantContent(message: Message): boolean {
  if (message.role !== "assistant") return true;

  for (const part of message.parts ?? []) {
    if (part.type === "text" && "text" in part && String(part.text ?? "").trim()) {
      return true;
    }
    if (part.type === "reasoning" && "text" in part && String(part.text ?? "").trim()) {
      return true;
    }
    if (part.type === "dynamic-tool" || part.type.startsWith("tool-")) {
      return true;
    }
    if (part.type === "file") {
      return true;
    }
  }

  return false;
}

function createEmptyResponseMessage(metadata?: ChatMessageMetadata): Message {
  return {
    id: `empty-response-${Date.now()}`,
    role: "assistant",
    metadata,
    parts: [{
      type: "text",
      text: "The selected provider finished without returning visible text or a tool call. Nothing was executed. Please retry this prompt; if it repeats, switch to a stronger tool-calling model for this task.",
    }],
  };
}

export function useChat(sessionId: string, initialMessages: Message[]) {
  // Cache project context so we only detect once per session
  const projectContextRef = useRef<string | null>(null);
  const projectContextLoadedRef = useRef(false);
  const projectContextPromiseRef = useRef<Promise<void> | null>(null);

  // MCP tools cache
  const mcpToolsRef = useRef<ReturnType<typeof getAllMcpTools> | null>(null);
  const mcpInitializedRef = useRef(false);
  const mcpPromiseRef = useRef<Promise<void> | null>(null);

  // Plugin tools cache
  const pluginsRef = useRef<Plugin[]>([]);
  const pluginsLoadedRef = useRef(false);
  const pluginsPromiseRef = useRef<Promise<void> | null>(null);

  // Memory cache
  const memoriesRef = useRef<string>("");
  const memoriesLoadedRef = useRef(false);
  const memoriesPromiseRef = useRef<Promise<void> | null>(null);

  // Streaming metrics
  const [streamMetrics, setStreamMetrics] = useState<StreamMetrics | null>(null);
  const streamMetricsLastUpdateRef = useRef(0);
  const emptyResponseGuardRef = useRef(false);

  // Bash streaming state (local to session, no provider needed)
  const [bashOutput, setBashOutput] = useState("");
  const [isBashStreaming, setIsBashStreaming] = useState(false);
  const bashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Human approval gate state
  const [pendingApproval, setPendingApproval] = useState<{
    toolCall: { toolName: string; toolCallId: string; input: unknown };
    resolve: () => void;
    reject: (err: Error) => void;
  } | null>(null);

  // Tools that require human confirmation before execution.
  // File edits run directly and show inline diffs in the message stream.
  const HIGH_IMPACT_TOOLS = ["bash", "spawnAgent"];

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

  const ensureProjectContext = useCallback(async () => {
    if (projectContextLoadedRef.current) return;
    if (!projectContextPromiseRef.current) {
      projectContextPromiseRef.current = buildProjectContext().then((ctx) => {
        projectContextRef.current = ctx;
      }).catch((err) => {
        console.error("[context] Failed to load project context:", err instanceof Error ? err.message : String(err));
      }).finally(() => {
        projectContextLoadedRef.current = true;
      });
    }
    await projectContextPromiseRef.current;
  }, []);

  const ensureMcp = useCallback(async () => {
    if (mcpInitializedRef.current) return;
    if (!mcpPromiseRef.current) {
      mcpPromiseRef.current = (async () => {
        if (!hasMcpConfig()) {
          mcpToolsRef.current = [];
          return;
        }

        const result = await initializeMcp();
        mcpToolsRef.current = getAllMcpTools();
        if (result.errors.length > 0) {
          console.error("[mcp] Some MCP servers failed:", result.errors.join("; "));
        }
      })().catch((err) => {
        console.error("[mcp] Failed to initialize MCP servers:", err instanceof Error ? err.message : String(err));
      }).finally(() => {
        mcpInitializedRef.current = true;
      });
    }
    await mcpPromiseRef.current;
  }, []);

  const ensurePlugins = useCallback(async () => {
    if (pluginsLoadedRef.current) return;
    if (!pluginsPromiseRef.current) {
      pluginsPromiseRef.current = loadPlugins().then((plugins) => {
        pluginsRef.current = plugins;
        if (plugins.length > 0) {
          console.error(`[plugins] Loaded ${plugins.length} plugin(s): ${plugins.map((p) => p.name).join(", ")}`);
        }
      }).catch((err) => {
        console.error("[plugins] Failed to load plugins:", err instanceof Error ? err.message : String(err));
      }).finally(() => {
        pluginsLoadedRef.current = true;
      });
    }
    await pluginsPromiseRef.current;
  }, []);

  const ensureMemories = useCallback(async () => {
    if (memoriesLoadedRef.current) return;
    if (!memoriesPromiseRef.current) {
      memoriesPromiseRef.current = retrieveRelevantMemories(
        projectContextRef.current ?? process.cwd(),
        process.cwd(),
      ).then((memories) => {
        if (memories.length > 0) {
          memoriesRef.current = formatMemoriesForPrompt(memories);
          console.error(`[memory] Loaded ${memories.length} relevant memories`);
        }
      }).catch((err) => {
        console.error("[memory] Failed to load memories:", err instanceof Error ? err.message : String(err));
      }).finally(() => {
        memoriesLoadedRef.current = true;
      });
    }
    await memoriesPromiseRef.current;
  }, []);

  const ensureRuntimeContext = useCallback(async () => {
    await ensureProjectContext();
    await Promise.all([
      ensureMcp(),
      ensurePlugins(),
      ensureMemories(),
    ]);
  }, [ensureProjectContext, ensureMcp, ensurePlugins, ensureMemories]);

  useEffect(() => {
    void ensureRuntimeContext();
  }, [ensureRuntimeContext]);

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

        // Build plugin tool definitions
        const pluginTools = pluginsToToolDefinitions(pluginsRef.current);

        // Combine external tools (MCP + plugins)
        const externalTools = [...mcpTools, ...pluginTools];

        return {
          body: {
            id: sessionId,
            messages: requestMessages,
            mode: message.metadata?.mode ?? metadata?.mode,
            model: message.metadata?.model ?? metadata?.model,
            // Send project context (AGENT.md + detected framework info)
            projectContext: projectContextRef.current ?? undefined,
            // Send MCP + plugin tool definitions so server can expose them to AI
            mcpTools: externalTools.length > 0 ? externalTools : undefined,
            // Send remembered context from previous sessions
            memories: memoriesRef.current || undefined,
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
      const model = chat.messages.at(-1)?.metadata?.model ?? "unknown";
      const MAX_RETRIES = 1;

      // Clear bash output when a new bash command starts
      if (toolCall.toolName === "bash") {
        setBashOutput("");
      }

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          // Human Approval Gate for high-impact actions
          if (HIGH_IMPACT_TOOLS.includes(toolCall.toolName)) {
            await new Promise<void>((resolve, reject) => {
              setPendingApproval({ toolCall, resolve, reject });
            });
            setPendingApproval(null);
          }

          const output = await executeLocalTool(
            toolCall.toolName,
            toolCall.input,
            mode,
            {
              onBashOutput,
              sessionId,
              model,
              runtimeContext: {
                projectContext: projectContextRef.current ?? undefined,
                memories: memoriesRef.current || undefined,
                externalTools: [
                  ...(mcpToolsRef.current?.map((tool) => ({
                    name: tool.name,
                    description: tool.description,
                    inputSchema: tool.inputSchema,
                  })) ?? []),
                  ...pluginsToToolDefinitions(pluginsRef.current).map((tool) => ({
                    name: tool.name,
                    description: tool.description,
                    inputSchema: tool.inputSchema,
                  })),
                ],
              },
            },
          );
          chat.addToolOutput({
            tool: toolCall.toolName as keyof ChatTools,
            toolCallId: toolCall.toolCallId,
            output,
          });
          return;
        } catch (error) {
          // If user explicitly rejected, don't retry — report immediately
          const isUserRejection = error instanceof Error && error.message === "User rejected this action.";
          if (isUserRejection || attempt === MAX_RETRIES) {
            const errorText = formatErrorMessage(error);
            chat.addToolOutput({
              tool: toolCall.toolName as keyof ChatTools,
              toolCallId: toolCall.toolCallId,
              state: "output-error",
              errorText,
            });
            return; // Don't retry if it failed (e.g., user rejected)
          }
          // Otherwise retry silently
        }
      }
    },
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
  });

  useEffect(() => {
    if (chat.status !== "ready" || !emptyResponseGuardRef.current) return;

    emptyResponseGuardRef.current = false;
    if (chat.error) return;

    chat.setMessages((messages) => {
      const currentLastMessage = messages.at(-1);
      if (!currentLastMessage) return messages;

      if (currentLastMessage.role === "user") {
        return [...messages, createEmptyResponseMessage(currentLastMessage.metadata)];
      }

      if (currentLastMessage.role === "assistant" && !hasVisibleAssistantContent(currentLastMessage)) {
        return [
          ...messages.slice(0, -1),
          createEmptyResponseMessage(currentLastMessage.metadata),
        ];
      }

      return messages;
    });
  }, [chat.status, chat.error, chat.messages, chat.setMessages]);

  // Track streaming progress
  useEffect(() => {
    const tracker = getStreamingTracker();
    if (chat.status === "streaming") {
      // Start tracking on first streaming status
      const lastMsg = chat.messages.at(-1);
      if (lastMsg?.role === "assistant") {
        const text = (lastMsg.parts ?? [])
          .filter((p) => p.type === "text" && "text" in p)
          .map((p) => (p as { text: string }).text)
          .join("");
        tracker.onChunk(text.slice(-50)); // Feed latest chunk
        const now = Date.now();
        if (now - streamMetricsLastUpdateRef.current > 250) {
          streamMetricsLastUpdateRef.current = now;
          setStreamMetrics(tracker.getMetrics());
        }
      }
    } else if (chat.status === "ready") {
      tracker.stop();
      streamMetricsLastUpdateRef.current = 0;
      const final = tracker.getMetrics();
      if (final.tokensGenerated > 0) {
        setStreamMetrics(final);
      }
      // Extract and save learnings when conversation settles
      if (chat.messages.length > 2) {
        const msgs = chat.messages.map((m) => ({
          role: m.role,
          parts: m.parts?.map((p) => ({ type: p.type, text: "text" in p ? (p as any).text : undefined })),
        }));
        const learnings = extractLearnings(msgs, process.cwd());
        if (learnings.length > 0) {
          saveMemories(learnings).catch(() => {});
        }
      }
    }
  }, [chat.status, chat.messages]);

  return {
    messages: chat.messages,
    status: chat.status,
    error: chat.error,
    bashOutput,
    isBashStreaming,
    streamMetrics,
    pendingApproval,
    approveTool: (approved: boolean) => {
      if (!pendingApproval) return;
      if (approved) {
        pendingApproval.resolve();
      } else {
        pendingApproval.reject(new Error("User rejected this action."));
      }
      setPendingApproval(null);
    },
    submit: async (params: { userText: string; mode: ModeType; model: SupportedChatModelId | string }) => {
      // Start streaming tracker
      getStreamingTracker().start();
      emptyResponseGuardRef.current = true;

      await ensureRuntimeContext();

      // Extract image mentions (@file.png) and convert to multimodal parts
      const { text, images, warnings } = await extractImageMentions(params.userText);

      // Log image attachment warnings
      if (warnings.length > 0) {
        for (const w of warnings) {
          console.error(`[image] ⚠ ${w}`);
        }
      }

      if (images.length > 0) {
        return chat.sendMessage({
          text,
          metadata: {
            mode: params.mode,
            model: params.model,
          },
          files: images.map((img) => new File(
            [Buffer.from(img.base64, "base64")],
            img.path,
            { type: img.mimeType },
          )),
        } as any);
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
