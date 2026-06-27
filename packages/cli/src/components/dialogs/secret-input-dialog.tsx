import { useCallback, useRef } from "react";
import { TextAttributes, type InputRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useDialog } from "../../providers/dialog";
import { useKeyboardLayer } from "../../providers/keyboard-layer";
import { useTheme } from "../../providers/theme";

type SecretInputDialogContentProps = {
  label: string;
  envName: string;
  description?: string;
  placeholder?: string;
  onSubmit: (value: string) => void;
};

export function SecretInputDialogContent({
  label,
  envName,
  description,
  placeholder = "Paste value...",
  onSubmit,
}: SecretInputDialogContentProps) {
  const inputRef = useRef<InputRenderable>(null);
  const dialog = useDialog();
  const { isTopLayer } = useKeyboardLayer();
  const { colors } = useTheme();

  const submit = useCallback(() => {
    const value = inputRef.current?.value.trim() ?? "";
    if (!value) return;
    onSubmit(value);
  }, [onSubmit]);

  useKeyboard((key) => {
    if (!isTopLayer("dialog")) return;

    if (key.name === "return" || key.name === "enter") {
      submit();
    } else if (key.name === "escape") {
      dialog.close();
    }
  });

  return (
    <box flexDirection="column" gap={1} width="100%">
      <text attributes={TextAttributes.BOLD}>{label}</text>
      <text attributes={TextAttributes.DIM}>
        {description || `Saved as ${envName} in .env and used for this session.`}
      </text>
      <box border={["left"]} borderColor={colors.primary} paddingX={1}>
        <input ref={inputRef} focused placeholder={placeholder} />
      </box>
      <text attributes={TextAttributes.DIM}>
        Press Enter to save. Press Esc to cancel.
      </text>
    </box>
  );
}
