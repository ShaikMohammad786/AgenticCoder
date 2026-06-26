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

  // Plugin tools cache
  const pluginsRef = useRef<Plugin[]>([]);
  const pluginsLoadedRef = useRef(false);

  // Memory cache
  const memoriesRef = useRef<string>("");
  const memoriesLoadedRef = useRef(false);

  // Streaming metrics
  const [streamMetrics, setStreamMetrics] = useState<StreamMetrics | null>(null);

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
      }).catch((err) => {
        console.error("[context] Failed to load project context:", err instanceof Error ? err.message : String(err));
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
      }).catch((err) => {
        console.error("[mcp] Failed to initialize MCP servers:", err instanceof Error ? err.message : String(err));
      });
    }
    // Load plugins
    if (!pluginsLoadedRef.current) {
      pluginsLoadedRef.current = true;
      loadPlugins().then((plugins) => {
        pluginsRef.current = plugins;
        if (plugins.length > 0) {
          console.error(`[plugins] Loaded ${plugins.length} plugin(s): ${plugins.map((p) => p.name).join(", ")}`);
        }
      }).catch((err) => {
        console.error("[plugins] Failed to load plugins:", err instanceof Error ? err.message : String(err));
      });
    }
    // Load relevant memories for this session
    if (!memoriesLoadedRef.current) {
      memoriesLoadedRef.current = true;
      retrieveRelevantMemories(
        projectContextRef.current ?? process.cwd(),
        process.cwd(),
      ).then((memories) => {
        if (memories.length > 0) {
          memoriesRef.current = formatMemoriesForPrompt(memories);
          console.error(`[memory] Loaded ${memories.length} relevant memories`);
        }
      }).catch((err) => {
        console.error("[memory] Failed to load memories:", err instanceof Error ? err.message : String(err));
      });
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
          const output = await executeLocalTool(
            toolCall.toolName,
            toolCall.input,
            mode,
            { onBashOutput, sessionId, model },
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
        setStreamMetrics(tracker.getMetrics());
      }
    } else if (chat.status === "ready") {
      tracker.stop();
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
    submit: async (params: { userText: string; mode: ModeType; model: SupportedChatModelId | string }) => {
      // Start streaming tracker
      getStreamingTracker().start();

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