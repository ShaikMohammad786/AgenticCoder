import { Mode, type ModeType } from "@agenticcoder/shared";
import { TextAttributes } from "@opentui/core";
import { EmptyBorder } from "../border";
import { useTheme } from "../../providers/theme";

type Props = {
  message: string;
  mode: ModeType;
};

export function UserMessage({ message, mode }: Props) {
  const { colors } = useTheme();
  const borderColor = mode === Mode.PLAN ? colors.planMode : colors.primary;

  return (
    <box width="100%" alignItems="center">
      <box
        border={["left"]}
        borderColor={borderColor}
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
        >
          <box flexDirection="row" justifyContent="space-between" width="100%">
            <text>{message}</text>
            <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
              {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </text>
          </box>
        </box>
      </box>
    </box>
  );
};