import { TextAttributes } from "@opentui/core";
import { EmptyBorder } from "../border";
import { useTheme } from "../../providers/theme";

type Props = {
  message: string;
};

function categorizeError(message: string): { icon: string; hint: string } {
  const lower = message.toLowerCase();
  if (lower.includes("rate limit") || lower.includes("429")) {
    return { icon: "●", hint: "Wait a moment and try again" };
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return { icon: "●", hint: "The request took too long" };
  }
  if (lower.includes("network") || lower.includes("fetch")) {
    return { icon: "●", hint: "Check your internet connection" };
  }
  if (lower.includes("auth") || lower.includes("unauthorized") || lower.includes("401")) {
    return { icon: "●", hint: "Try /login to re-authenticate" };
  }
  return { icon: "✗", hint: "Try again or start a /new session" };
}

export function ErrorMessage({ message }: Props) {
  const { colors } = useTheme();
  const { icon, hint } = categorizeError(message);

  return (
    <box width="100%" alignItems="center">
      <box
        border={["left"]}
        borderColor={colors.error}
        width="100%"
        customBorderChars={{
          ...EmptyBorder,
          vertical: "┃",
          bottomLeft: "╹",
        }}
      >
        <box
          justifyContent="center"
          paddingX={2}
          paddingY={1}
          backgroundColor={colors.surface}
          width="100%"
          gap={0}
        >
          <text fg={colors.error}>
            {icon} {message}
          </text>
          <text attributes={TextAttributes.DIM}>
            {hint}
          </text>
        </box>
      </box>
    </box>
  );
};