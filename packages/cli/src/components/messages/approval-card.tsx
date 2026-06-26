import { useTheme } from "../../providers/theme";
import { useKeyboard } from "@opentui/react";
import { useState } from "react";

type ToolCallInfo = {
  toolName: string;
  toolCallId: string;
  input: unknown;
};

export function ApprovalCard({
  toolCall,
  onApprove,
  onReject,
}: {
  toolCall: ToolCallInfo;
  onApprove: () => void;
  onReject: () => void;
}) {
  const { colors, borders } = useTheme();
  const [selected, setSelected] = useState<"approve" | "reject">("approve");

  useKeyboard((key) => {
    if (key.name === "left" || key.name === "right") {
      setSelected((prev) => (prev === "approve" ? "reject" : "approve"));
    }
    if (key.name === "return") {
      if (selected === "approve") onApprove();
      else onReject();
    }
  });

  // Extract a human-readable summary of what the tool wants to do
  const input = toolCall.input as Record<string, unknown> | undefined;
  let detail = "";
  if (toolCall.toolName === "bash" && input?.command) {
    detail = String(input.command);
  } else if (toolCall.toolName === "writeFile" && input?.path) {
    detail = `Write to: ${input.path}`;
  } else if (toolCall.toolName === "editFile" && input?.path) {
    detail = `Edit: ${input.path}`;
  } else if (toolCall.toolName === "searchReplace" && input?.path) {
    detail = `Search & replace in: ${input.path}`;
  } else if (toolCall.toolName === "spawnAgent" && input?.agents) {
    const agents = input.agents as Array<{ type: string }>;
    detail = `Spawn ${agents.length} agent(s): ${agents.map(a => a.type).join(", ")}`;
  } else {
    detail = JSON.stringify(toolCall.input);
  }

  return (
    <box
      borderStyle={borders.style}
      borderColor="yellow"
      flexDirection="column"
      paddingX={1}
      width="100%"
    >
      <text bold fg="yellow">-- Action Requires Approval --</text>
      <text>Tool: {toolCall.toolName}</text>
      <text dimColor>{detail}</text>
      <box flexDirection="row" marginTop={1}>
        <text
          fg={selected === "approve" ? "black" : colors.primary}
          bg={selected === "approve" ? colors.primary : undefined}
        >
          {" Approve "}
        </text>
        <text>{"  "}</text>
        <text
          fg={selected === "reject" ? "white" : "red"}
          bg={selected === "reject" ? "red" : undefined}
        >
          {" Reject "}
        </text>
      </box>
      <text dimColor italic>Use arrow keys to select, Enter to confirm</text>
    </box>
  );
}
