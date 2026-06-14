import { Outlet } from "react-router";
import { ToastProvider } from "../providers/toast";
import { DialogProvider } from "../providers/dialog";
import { KeyboardLayerProvider } from "../providers/keyboard-layer";
import { ThemeProvider } from "../providers/theme";
import { ThemedRoot } from "./themed-root";
import { PromptConfigProvider } from "../providers/prompt-config";

export function RootLayout() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <KeyboardLayerProvider>
          <PromptConfigProvider>
            <DialogProvider>
              <ThemedRoot>
                <Outlet />
              </ThemedRoot>
            </DialogProvider>
          </PromptConfigProvider>
        </KeyboardLayerProvider>
      </ToastProvider>
    </ThemeProvider>
  );
};