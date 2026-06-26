import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useParams, useLocation, useNavigate } from "react-router";
import { z } from "zod";
import { useKeyboard } from "@opentui/react";
import { type ModeType, type SupportedChatModelId } from "@agenticcoder/shared";
import { SessionShell } from "../components/session-shell";
import { 
  UserMessage, 
  BotMessage, 
  ErrorMessage
} from "../components/messages";
import { useToast } from "../providers/toast";
import { useChat } from "../hooks/use-chat";
import { usePromptConfig } from "../providers/prompt-config";
import type { Message } from "../hooks/use-chat";
import { ApprovalCard, GoalTracker } from "../components/messages";
import { useGoalTracker } from "../hooks/use-goal-tracker";
import { SubAgentOrchestrator } from "../lib/subagent";
import { apiClient } from "../lib/api-client";
import { getErrorMessage } from "../lib/http-errors";
import { useKeyboardLayer } from "../providers/keyboard-layer";
import { getFileWatcher, formatFileChanges } from "../lib/file-watcher";

type SessionData = {
  id: string;
  title: string;
  userId: string;
  messages: unknown;
  createdAt: string;
  updatedAt: string;
};

const sessionLocationSchema = z.object({
  session: z.custom<SessionData>((val) => val != null && typeof val === "object" && "id" in val),
  initialPrompt: z
    .object({
      message: z.string(),
      mode: z.custom<ModeType>(),
      model: z.custom<SupportedChatModelId>(),
    })
    .optional(),
});

function ChatMessage(
  { msg, bashOutput, isBashStreaming }: {
    msg: Message;
    bashOutput?: string;
    isBashStreaming?: boolean;
  }
) {
  if (msg.role === "user") {
    const text = msg.parts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("");

    return <UserMessage message={text} mode={msg.metadata?.mode ?? "BUILD"} />;
  }

  return (
    <BotMessage
      parts={msg.parts}
      model={msg.metadata?.model ?? "unknown"}
      mode={msg.metadata?.mode ?? "BUILD"}
      durationMs={msg.metadata?.durationMs}
      usage={msg.metadata?.usage}
      streaming={false}
      bashOutput={bashOutput}
      isBashStreaming={isBashStreaming}
    />
  );
};

function SessionChat({ 
  session,
  initialPrompt,
}: { 
  session: SessionData,
  initialPrompt?: { message: string; mode: ModeType; model: SupportedChatModelId };
}) {
  const [initialMessages] = useState(() => session.messages as unknown as Message[]);
  const { mode, model } = usePromptConfig();
  const { isTopLayer } = useKeyboardLayer();
  const toast = useToast();
  const { messages, status, submit, abort, interrupt, error, bashOutput, isBashStreaming, streamMetrics, pendingApproval, approveTool } = useChat(
    session.id,
    initialMessages
  );
  const { goal, isPlanning, planError, startGoal, updateTaskStatus, abortGoal } = useGoalTracker();
  const hasSubmittedInitialPromptRef = useRef(false);

  // Stop the pending reply when the user leaves this session.
  // Also start/stop file watcher.
  useEffect(() => {
    const watcher = getFileWatcher();
    watcher.start(process.cwd(), (event) => {
      toast.show({
        message: formatFileChanges(event.files),
      });
    });
    return () => {
      watcher.stop();
      abortGoal();
      void abort();
    };
  }, [abort, abortGoal, toast]);

  // Let the user cancel a reply even before the first streamed chunk arrives.
  useKeyboard((key) => {
    if (key.name === "escape" && isTopLayer("base") && status === "streaming") {
      key.preventDefault();
      interrupt();
    }
  });

  useEffect(() => {
    if (!initialPrompt || hasSubmittedInitialPromptRef.current) return;
    hasSubmittedInitialPromptRef.current = true;
    
    // Check if it's a /goal command
    if (initialPrompt.message.startsWith("/goal ")) {
      const goalText = initialPrompt.message.slice(6).trim();
      void startGoal(goalText, initialPrompt.model);
    } else {
      void submit({
        userText: initialPrompt.message,
        mode: initialPrompt.mode,
        model: initialPrompt.model,
      });
    }
  }, [initialPrompt, submit, startGoal]);

  // When planning finishes and the goal is NOT complex, fall through to normal chat
  useEffect(() => {
    if (!goal || goal.active || isPlanning) return;
    if (goal.prompt && !goal.isComplex) {
      void submit({
        userText: goal.prompt,
        mode,
        model,
      });
    }
  }, [goal, isPlanning, submit, mode, model]);

  // Goal Orchestration Loop — runs tasks sequentially via SubAgentOrchestrator
  useEffect(() => {
    if (!goal || !goal.active) return;
    
    const nextTask = goal.tasks.find(t => t.status === "pending");
    if (!nextTask) {
      // All tasks processed
      const allDone = goal.tasks.every(t => t.status === "done");
      if (allDone) {
        toast.show({ message: "All goal tasks completed successfully." });
      }
      return;
    }

    // Mark running
    updateTaskStatus(nextTask.id, "running");

    // Instantiate the orchestrator properly and execute
    const orchestrator = new SubAgentOrchestrator(session.id, model, mode);
    orchestrator.execute([{
      type: nextTask.role as any, // role is already a valid AgentTypeValue from planner
      task: nextTask.description,
      context: goal.prompt,
    }], 1)
      .then((results) => {
        const result = results[0];
        if (result && result.status === "completed") {
          updateTaskStatus(nextTask.id, "done");
          toast.show({ message: `Task completed: ${nextTask.description}` });
        } else {
          updateTaskStatus(nextTask.id, "failed");
          const errMsg = result?.errors?.join("; ") || "Unknown error";
          toast.show({ variant: "error", message: `Task failed: ${errMsg}` });
        }
      })
      .catch((err) => {
        updateTaskStatus(nextTask.id, "failed");
        toast.show({ variant: "error", message: `Error: ${err instanceof Error ? err.message : String(err)}` });
      });
  }, [goal, model, mode, session.id, updateTaskStatus, toast]);

  // Build streaming status text
  const streamingStatus = useMemo(() => {
    if (!streamMetrics) return undefined;
    const parts: string[] = [];
    if (streamMetrics.tokensPerSecond > 0) parts.push(`${streamMetrics.tokensPerSecond} tok/s`);
    const secs = (streamMetrics.elapsedMs / 1000).toFixed(1);
    parts.push(`${secs}s`);
    if (streamMetrics.tokensGenerated > 0) {
      const tkn = streamMetrics.tokensGenerated >= 1000
        ? `${(streamMetrics.tokensGenerated / 1000).toFixed(1)}K`
        : String(streamMetrics.tokensGenerated);
      parts.push(`${tkn} tokens`);
    }
    if (streamMetrics.estimatedCost > 0.0001) parts.push(`$${streamMetrics.estimatedCost.toFixed(4)}`);

    // SubAgent status indicator
    try {
      const { getActiveAgents } = require("../lib/subagent");
      const active = getActiveAgents();
      const running = [...active.values()].filter(a => a.status === "running");
      if (running.length > 0) {
        const agentTypes = running.map(a => a.type).join(", ");
        parts.push(`${running.length} agent${running.length > 1 ? "s" : ""}: ${agentTypes}`);
      }
    } catch {
      // subagent module not loaded yet — ignore
    }

    return parts.length > 0 ? parts.join("  ·  ") : undefined;
  }, [streamMetrics]);

  return (
    <SessionShell
      onSubmit={(text) => {
        if (text.startsWith("/goal ")) {
           void startGoal(text.slice(6).trim(), model);
        } else {
           submit({ userText: text, mode, model });
        }
      }}
      loading={status === "submitted" || status === "streaming" || isPlanning}
      interruptible={status === "submitted" || status === "streaming" || isPlanning}
      streamingStatus={streamingStatus}
    >
      <GoalTracker goal={goal} isPlanning={isPlanning} planError={planError} />

      {messages.map((msg) => (
        <ChatMessage key={msg.id} msg={msg} bashOutput={bashOutput} isBashStreaming={isBashStreaming} />
      ))}
      
      {pendingApproval && (
        <ApprovalCard 
          toolCall={pendingApproval.toolCall} 
          onApprove={() => approveTool(true)} 
          onReject={() => approveTool(false)} 
        />
      )}

      {error && <ErrorMessage message={error.message} />}
    </SessionShell>
  );
}

export function Session() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();

  const prefetched = useMemo(() => {
    const parsed = sessionLocationSchema.safeParse(location.state);
    return parsed.success ? parsed.data : null;
  }, [location.state]);

  const [session, setSession] = useState<SessionData | null>(prefetched?.session ?? null);

  useEffect(() => {
    // Skip fetch if session was passed via location state
    if (prefetched?.session) return;

    setSession(null);

    if (!id) return;

    let ignore = false;
    const fetchSession = async () => {
      try {
        const res = await apiClient.sessions[":id"].$get({ 
          param: { id },
        });
        if (ignore) return;
        if (!res.ok) throw new Error(await getErrorMessage(res));
        const resolved = await res.json();
        setSession(resolved);
      } catch (err) {
        if (ignore) return;
        toast.show({
          variant: "error",
          message: err instanceof Error ? err.message : "Failed to load session",
        });
        navigate("/", { replace: true });
      }
    };

    fetchSession();
    return () => {
      ignore = true;
    };
  }, [id, prefetched, toast, navigate]);

  if (!session) {
    return <SessionShell onSubmit={() => {}} inputDisabled loading />;
  }

  return (
    <SessionChat 
      key={session.id} 
      session={session} 
      initialPrompt={prefetched?.initialPrompt}
    />
  );
};