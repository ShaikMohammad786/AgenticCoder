import { useCallback } from "react";
import { useNavigate } from "react-router";
import { Header } from "../components/Header";
import { InputBar } from "../components/Input-bar";
import { usePromptConfig } from "../providers/prompt-config";
import { TextAttributes } from "@opentui/core";
import { useTheme } from "../providers/theme";

export function Home() {
  const navigate = useNavigate();
  const { mode, model } = usePromptConfig();
  const { colors } = useTheme();

  const handleSubmit = useCallback(
    (text: string) => {
      navigate("/sessions/new", { state: { message: text, mode, model } });
    },
    [navigate, mode, model],
  );

  return (
    <box
      alignItems="center"
      justifyContent="center"
      flexGrow={1}
      gap={2}
      position="relative"
      width="100%"
      height="100%"
    >
      <Header />
      <box width="100%" maxWidth={78} paddingX={2} flexDirection="column" gap={1}>
        <InputBar onSubmit={handleSubmit} />
        <box flexDirection="row" gap={1} flexShrink={0} justifyContent="center" width="100%">
          <text attributes={TextAttributes.DIM}>tab</text>
          <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>agents</text>
          <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>·</text>
          <text attributes={TextAttributes.DIM}>/ </text>
          <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>commands</text>
          <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>·</text>
          <text attributes={TextAttributes.DIM}>@ </text>
          <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>files</text>
        </box>
      </box>
    </box>
  );
};