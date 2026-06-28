import { useEffect, useMemo, useState } from "react";
import { TextAttributes } from "@opentui/core";
import { getActiveAgent, getActiveAgents, type ActiveSubAgent } from "../lib/subagent";
import { sanitizeTerminalText } from "../lib/terminal-markdown";
import { useDialog } from "../providers/dialog";
import { useTheme } from "../providers/theme";

function partText(part: Record<string, unknown>): string {
  if (part.type === "text" || part.type === "reasoning") {
    return sanitizeTerminalText(String(part.text ?? ""));
  }

  if (typeof part.type === "string" && part.type.startsWith("tool-")) {
    const toolName = part.type.slice("tool-".length);
    const state = String(part.state ?? "pending");
    const input = part.input == null ? "" : ` ${sanitizeTerminalText(JSON.stringify(part.input))}`;
    const error = part.errorText == null ? "" : ` ${sanitizeTerminalText(String(part.errorText))}`;
    return `${toolName} (${state})${input}${error}`;
  }

  if (part.type === "dynamic-tool") {
    const toolName = sanitizeTerminalText(String(part.toolName ?? "tool"));
    const state = String(part.state ?? "pending");
    const input = part.input == null ? "" : ` ${sanitizeTerminalText(JSON.stringify(part.input))}`;
    const error = part.errorText == null ? "" : ` ${sanitizeTerminalText(String(part.errorText))}`;
    return `${toolName} (${state})${input}${error}`;
  }

  return "";
}

function agentLabel(agent: ActiveSubAgent): string {
  const status =
    agent.status === "running" ? "..." :
    agent.status === "completed" ? "ok" :
    agent.status === "timeout" ? "timeout" :
    "fail";
  return `${agent.type}:${status}`;
}

function SubAgentConversationDialog({ agentId }: { agentId: string }) {
  const { colors } = useTheme();
  const [agent, setAgent] = useState(() => getActiveAgent(agentId));

  useEffect(() => {
    const timer = setInterval(() => setAgent(getActiveAgent(agentId)), 500);
    return () => clearInterval(timer);
  }, [agentId]);

  if (!agent) {
    return (
      <box paddingX={1} paddingY={1}>
        <text attributes={TextAttributes.DIM}>Subagent is no longer available.</text>
      </box>
    );
  }

  const elapsed = Math.max(0, Math.round((agent.updatedAt - agent.startedAt) / 1000));

  return (
    <box flexDirection="column" gap={1} width="100%">
      <box flexDirection="column">
        <text fg={colors.primary}>
          {agent.type} - {agent.status} - {elapsed}s
        </text>
        <text attributes={TextAttributes.DIM}>{sanitizeTerminalText(agent.task)}</text>
      </box>

      <scrollbox height={18} width="100%">
        <box flexDirection="column" gap={1}>
          {agent.messages.map((message) => (
            <box key={message.id} flexDirection="column" width="100%">
              <text
                attributes={TextAttributes.BOLD}
                fg={message.role === "user" ? colors.info : colors.primary}
              >
                {message.role === "user" ? "User" : "Subagent"}
              </text>
              {message.parts.map((part, index) => {
                const text = partText(part);
                if (!text.trim()) return null;
                return (
                  <text
                    key={`${message.id}-${index}`}
                    attributes={part.type === "text" ? undefined : TextAttributes.DIM}
                  >
                    {text}
                  </text>
                );
              })}
            </box>
          ))}
          {agent.summary ? (
            <box flexDirection="column">
              <text attributes={TextAttributes.BOLD} fg={colors.success}>Summary</text>
              <text>{sanitizeTerminalText(agent.summary)}</text>
            </box>
          ) : null}
          {agent.errors && agent.errors.length > 0 ? (
            <box flexDirection="column">
              <text attributes={TextAttributes.BOLD} fg={colors.error}>Errors</text>
              {agent.errors.map((error, index) => (
                <text key={index} fg={colors.error}>{sanitizeTerminalText(error)}</text>
              ))}
            </box>
          ) : null}
          <text attributes={TextAttributes.DIM}>Log: {agent.logPath}</text>
        </box>
      </scrollbox>
    </box>
  );
}

export function SubAgentStatusBar() {
  const dialog = useDialog();
  const { colors } = useTheme();
  const [agents, setAgents] = useState<ActiveSubAgent[]>([]);

  useEffect(() => {
    const refresh = () => setAgents([...getActiveAgents().values()]);
    refresh();
    const timer = setInterval(refresh, 500);
    return () => clearInterval(timer);
  }, []);

  const visibleAgents = useMemo(
    () => agents
      .filter((agent) => agent.status === "running" || Date.now() - agent.updatedAt < 10_000)
      .slice(-4),
    [agents],
  );

  if (visibleAgents.length === 0) return null;

  return (
    <box flexDirection="row" gap={1}>
      {visibleAgents.map((agent) => {
        const isRunning = agent.status === "running";
        const fg =
          isRunning ? colors.primary :
          agent.status === "completed" ? colors.success :
          colors.error;

        return (
          <box
            key={agent.id}
            paddingX={1}
            backgroundColor={isRunning ? colors.surface : undefined}
            onMouseDown={() => dialog.open({
              title: `Subagent ${agent.type}`,
              children: <SubAgentConversationDialog agentId={agent.id} />,
            })}
          >
            <text fg={fg}>{agentLabel(agent)}</text>
          </box>
        );
      })}
    </box>
  );
}
