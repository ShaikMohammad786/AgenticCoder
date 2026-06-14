import { TextAttributes } from "@opentui/core";
import { useTheme } from "../providers/theme";

export function Header() {
  const { colors } = useTheme();

  return (
    <box justifyContent="center" alignItems="center" flexDirection="column" gap={1}>
      <box flexDirection="row" justifyContent="center" gap={0.5} alignItems="center">
        <ascii-font font="tiny" text="Agentic" color="grey"></ascii-font>
        <ascii-font font="tiny" text="coder" />
      </box>
      <text attributes={TextAttributes.DIM}>
        AI-powered coding assistant · type <em fg={colors.primary}>/help</em> for commands
      </text>
    </box>
  );
}