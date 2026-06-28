import prettyMs from "pretty-ms";
import { EmptyBorder } from "../border";
import { useTheme } from "../../providers/theme";
import type { Message } from "../../hooks/use-chat";
import { Mode, type ModeType } from "@agenticcoder/shared";
import { TextAttributes } from "@opentui/core";
import { hasMarkdownSyntax, renderMarkdown, sanitizeTerminalText } from "../../lib/terminal-markdown";

type ClientMessagePart = Message["parts"][number];
type ToolPart = Extract<ClientMessagePart, { type: `tool-${string}` | "dynamic-tool" }>;

type Props = {
  parts: ClientMessagePart[];
  model: string;
  mode: ModeType;
  durationMs?: number;
  usage?: { inputTokens?: number; outputTokens?: number };
  streaming?: boolean;
  bashOutput?: string;
  isBashStreaming?: boolean;
};

function formatToolName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
};

function isToolPart(part: ClientMessagePart): part is ToolPart {
  return part.type === "dynamic-tool" || part.type.startsWith("tool-");
};

function formatToolArgs(tc: ToolPart): string {
  if (!("input" in tc) || tc.input == null) return "";
  if (typeof tc.input !== "object") return sanitizeTerminalText(String(tc.input));
  return sanitizeTerminalText(Object.values(tc.input).map(String).join(" "));
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

type PartGroup = {
  type: ClientMessagePart["type"];
  parts: ClientMessagePart[];
  key: string;
};

function groupConsecutiveParts(parts: ClientMessagePart[]): PartGroup[] {
  const groups: PartGroup[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const lastGroup = groups[groups.length - 1];

     if (lastGroup && lastGroup.type === part.type) {
      lastGroup.parts.push(part);
     } else {
      const key = 
        isToolPart(part) ? `group-tc-${part.toolCallId}` : `group-${part.type}-${i}`;
      groups.push({ type: part.type, parts: [part], key });
     }
  }

  return groups;
};

export function BotMessage({ 
  parts,
  model,
  mode,
  durationMs,
  usage,
  streaming = false,
  bashOutput = "",
  isBashStreaming = false,
}: Props) {
  const { colors } = useTheme();
  return (
    <box width="100%" alignItems="center">
      {groupConsecutiveParts(parts).map((group, i) => (
        <box key={group.key} width="100%" paddingTop={i === 0 ? 0 : 1}>
          {group.parts.map((part, j) => {
            if (part.type === "reasoning") {
              if (!part.text || !part.text.trim()) return null;
              return (
                <box
                  key={`reasoning-${j}`}
                  border={["left"]}
                  borderColor={colors.thinkingBorder}
                  customBorderChars={{
                    ...EmptyBorder,
                    vertical: "│",
                  }}
                  width="100%"
                  paddingX={2}
                >
                  <text attributes={TextAttributes.DIM}>
                    <em fg={colors.thinking}>Thinking:</em> {sanitizeTerminalText(part.text)}
                  </text>
                </box>
              );
            }

            if (isToolPart(part)) {
              const toolName =
                part.type === "dynamic-tool" ? part.toolName : part.type.slice("tool-".length);
              const isPending = part.state !== "output-available" && part.state !== "output-error";
              const isError = part.state === "output-error";
              const isBash = toolName === "bash";
              const isFileWrite = ["editFile", "writeFile", "searchReplace"].includes(toolName);
              const showLiveOutput = isBash && isPending && isBashStreaming && bashOutput.trim().length > 0;

              // Extract inline diff from tool output
              let inlineDiff: string | null = null;
              if (!isPending && !isError && isFileWrite && "output" in part) {
                try {
                  const output = typeof part.output === "string" ? JSON.parse(part.output) : part.output;
                  if (output && typeof output === "object" && "diff" in output) {
                    inlineDiff = String(output.diff);
                  }
                } catch {
                  // ignore parse errors
                }
              }

              return (
                <box key={part.toolCallId} width="100%">
                  <box
                    border={["left"]}
                    borderColor={isError ? colors.error : colors.thinkingBorder}
                    customBorderChars={{
                      ...EmptyBorder,
                      vertical: "│",
                    }}
                    width="100%"
                    paddingX={2}
                  >
                    <text attributes={TextAttributes.DIM}>
                      <em fg={isError ? colors.error : colors.info}>
                        {isPending ? "▸ " : isError ? "✗ " : "✓ "}
                        {formatToolName(toolName)}:
                      </em>{" "}
                      {formatToolArgs(part)}
                      {isPending ? " ..." : ""}
                      {isError ? ` ${sanitizeTerminalText(String(part.errorText ?? ""))}` : ""}
                    </text>
                  </box>
                  {/* Inline diff for file edits */}
                  {inlineDiff && (
                    <box
                      border={["left"]}
                      borderColor={colors.thinkingBorder}
                      customBorderChars={{
                        ...EmptyBorder,
                        vertical: "┊",
                      }}
                      width="100%"
                      paddingX={4}
                    >
                      {sanitizeTerminalText(inlineDiff).split("\n").slice(0, 20).map((line, lineIndex) => (
                        <text
                          key={`diff-${part.toolCallId}-${lineIndex}`}
                          fg={diffLineColor(line, colors)}
                          attributes={line.startsWith(" ") ? TextAttributes.DIM : undefined}
                        >
                          {line.length > 0 ? line : " "}
                        </text>
                      ))}
                      {sanitizeTerminalText(inlineDiff).split("\n").length > 20 && (
                        <text attributes={TextAttributes.DIM}>
                          {`  ... ${sanitizeTerminalText(inlineDiff).split("\n").length - 20} more lines`}
                        </text>
                      )}
                    </box>
                  )}
                  {showLiveOutput && (
                    <box
                      border={["left"]}
                      borderColor={colors.thinkingBorder}
                      customBorderChars={{
                        ...EmptyBorder,
                        vertical: "┊",
                      }}
                      width="100%"
                      paddingX={4}
                    >
                      <text attributes={TextAttributes.DIM}>
                        {sanitizeTerminalText(bashOutput).trim().split("\n").slice(-8).join("\n")}
                      </text>
                    </box>
                  )}
                </box>
              );
            }

            if (part.type === "text") {
              const displayText = renderMessageText(part.text ?? "", streaming);
              return (
                <box key={`text-${j}`} paddingX={3} width="100%">
                  <text>{displayText}</text>
                </box>
              );
            }
            
            return null;
          })}
        </box>
      ))}

      <box paddingX={3} paddingY={1} gap={1} width="100%">
        <box flexDirection="row" gap={2}>
          <text fg={mode === Mode.PLAN ? colors.planMode : colors.primary}>◉</text>
          <box flexDirection="row" gap={1}>
            <text>
              {mode === Mode.PLAN ? "Plan" : "Build"}
            </text>
            <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
              ›
            </text>
            <text attributes={TextAttributes.DIM}>{model}</text>
            {(durationMs != null) && (
              <>
                <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
                  ›
                </text>
                <text attributes={TextAttributes.DIM}>
                  {prettyMs(durationMs)}
                </text>
              </>
            )}
            {usage && (usage.inputTokens != null || usage.outputTokens != null) && (
              <>
                <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
                  ›
                </text>
                <text attributes={TextAttributes.DIM}>
                  {formatTokens(usage.inputTokens ?? 0)}↑ {formatTokens(usage.outputTokens ?? 0)}↓
                </text>
              </>
            )}
          </box>
        </box>
      </box>
    </box>
  );
};

function renderMessageText(text: string, streaming: boolean): string {
  const cleanText = sanitizeTerminalText(text);
  if (streaming || !hasMarkdownSyntax(cleanText)) return cleanText;
  return renderMarkdown(cleanText);
}

function diffLineColor(line: string, colors: ReturnType<typeof useTheme>["colors"]) {
  if (line.startsWith("+")) return "#82E0AA";
  if (line.startsWith("-")) return "#E74C5E";
  if (line.startsWith("@@") || line.startsWith("---") || line.startsWith("+++")) return colors.info;
  return undefined;
}
