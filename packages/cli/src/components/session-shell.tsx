import { TextAttributes } from "@opentui/core";
import { useState, useEffect, type ReactNode } from "react";
import { InputBar } from "./Input-bar";
import { Spinner } from "./spinner";
import { usePromptConfig } from "../providers/prompt-config";
import { Mode } from "@agenticcoder/shared";
import { useTheme } from "../providers/theme";

function StreamingTimer() {
  const [elapsed, setElapsed] = useState(0);
  const { colors } = useTheme();

  useEffect(() => {
    setElapsed(0);
    const interval = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
      {elapsed < 2 ? "Thinking..." : `Thinking... ${elapsed}s`}
    </text>
  );
}

type Props = {
  children?: ReactNode;
  onSubmit: (text: string) => void;
  inputDisabled?: boolean;
  loading?: boolean;
  interruptible?: boolean;
  streamingStatus?: string;
  footerExtra?: ReactNode;
};

export function SessionShell({
  children,
  onSubmit,
  inputDisabled = false,
  loading = false,
  interruptible = false,
  streamingStatus,
  footerExtra,
}: Props) {
  const { mode } = usePromptConfig();
  const { colors } = useTheme();

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      width="100%"
      height="100%"
      paddingY={1}
      paddingX={2}
      gap={1}
    >
      <scrollbox flexGrow={1} width="100%" stickyScroll stickyStart="bottom">
        <box>{children}</box>
      </scrollbox>
      <box flexShrink={0}>
        <InputBar onSubmit={onSubmit} disabled={inputDisabled} />
      </box>
      <box
        flexShrink={0}
        flexDirection="row"
        justifyContent="space-between"
        width="100%"
        height={1}
        gap={2}
        paddingLeft={1}
      >
        <box flexDirection="row" alignItems="center" gap={2}>
          {loading ? (
            <>
              <Spinner mode={mode} />
              <StreamingTimer />
              {streamingStatus ? (
                <text attributes={TextAttributes.DIM}>{streamingStatus}</text>
              ) : null}
              {footerExtra}
              {interruptible ? <text>esc to interrupt</text> : null}
            </>
          ) : streamingStatus ? (
            <>
              <text attributes={TextAttributes.DIM}>{streamingStatus}</text>
              {footerExtra}
            </>
          ) : footerExtra ? (
            footerExtra
          ) : null}
        </box>

        <box flexDirection="row" gap={1} flexShrink={0} marginLeft="auto">
          <text attributes={TextAttributes.DIM}>tab</text>
          <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>·</text>
          <text attributes={TextAttributes.DIM}>
            {mode === Mode.PLAN ? "plan" : "build"}
          </text>
          <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>·</text>
          <text attributes={TextAttributes.DIM}>/ commands</text>
        </box>
      </box>
    </box>
  );
};
