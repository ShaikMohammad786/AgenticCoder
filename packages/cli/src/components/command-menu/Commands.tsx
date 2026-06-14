import { SUPPORTED_CHAT_MODELS } from "@agenticcoder/shared";
import { 
  AgentsDialogContent,
  ModelsDialogContent,
  SessionsDialogContent,
  ThemeDialogContent,
} from "../dialogs";
import type { Command } from "./types";

import { performLogin } from "../../lib/oauth";
import { clearAuth, getAuth } from "../../lib/auth";
import { undoToLastCheckpoint } from "../../lib/checkpoint";

import { openBillingPortal, openUpgradeCheckout } from "../../lib/upgrade";

export const COMMANDS: Command[] = [
  {
    name: "new",
    description: "Start a new conversation",
    value: "/new",
    action: (ctx) => {
      ctx.navigate("/");
    },
  },
  {
    name: "clear",
    description: "Clear chat and start fresh",
    value: "/clear",
    action: (ctx) => {
      ctx.navigate("/");
      ctx.toast.show({ message: "Chat cleared" });
    },
  },
  {
    name: "undo",
    description: "Revert all AI changes since last checkpoint",
    value: "/undo",
    action: async (ctx) => {
      ctx.toast.show({ message: "Reverting changes..." });
      try {
        const result = await undoToLastCheckpoint();
        ctx.toast.show({
          variant: result.success ? "success" : "error",
          message: result.message,
        });
      } catch (error) {
        ctx.toast.show({
          variant: "error",
          message: error instanceof Error ? error.message : "Undo failed",
        });
      }
    },
  },
  {
    name: "commit",
    description: "Git commit all current changes",
    value: "/commit",
    action: async (ctx) => {
      ctx.toast.show({ message: "Committing changes..." });
      try {
        const proc1 = Bun.spawn(["git", "add", "-A"], { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" });
        await proc1.exited;
        const statusProc = Bun.spawn(["git", "status", "--porcelain"], { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" });
        const statusOutput = await new Response(statusProc.stdout).text();
        await statusProc.exited;
        if (!statusOutput.trim()) {
          ctx.toast.show({ message: "Nothing to commit — working tree clean." });
          return;
        }
        const diffProc = Bun.spawn(["git", "diff", "--cached", "--stat"], { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" });
        const diffStat = await new Response(diffProc.stdout).text();
        await diffProc.exited;
        const fileCount = diffStat.trim().split("\n").length - 1;
        const commitMsg = `chore: AgenticCoder changes (${fileCount} file${fileCount !== 1 ? "s" : ""})`;
        const proc2 = Bun.spawn(["git", "commit", "-m", commitMsg], { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" });
        await proc2.exited;
        const exitCode = await proc2.exited;
        if (exitCode === 0) {
          ctx.toast.show({ variant: "success", message: `Committed: ${commitMsg}` });
        } else {
          ctx.toast.show({ variant: "error", message: "Git commit failed" });
        }
      } catch (error) {
        ctx.toast.show({
          variant: "error",
          message: error instanceof Error ? error.message : "Commit failed",
        });
      }
    },
  },
  {
    name: "help",
    description: "Show all available commands",
    value: "/help",
    action: (ctx) => {
      ctx.toast.show({
        message: "Commands: /new /clear /undo /commit /agents /models /sessions /theme /login /logout /upgrade /usage /help /status /exit",
      });
    },
  },
  {
    name: "status",
    description: "Show current configuration",
    value: "/status",
    action: (ctx) => {
      ctx.toast.show({
        message: `Mode: ${ctx.mode} · CWD: ${process.cwd()}`,
      });
    },
  },
  {
    name: "agents",
    description: "Switch agents",
    value: "/agents",
    action: (ctx) => {
      ctx.dialog.open({
        title: "Select Agent",
        children: <AgentsDialogContent currentMode={ctx.mode} onSelectMode={ctx.setMode} />,
      })
    },
  },
  {
    name: "models",
    description: "Select AI model for generation",
    value: "/models",
    action: (ctx) => {
      ctx.dialog.open({
        title: "Select Model",
        children: (
          <ModelsDialogContent
            models={SUPPORTED_CHAT_MODELS.map((model) => model.id)}
            onSelectModel={ctx.setModel}
          />
        ),
      })
    },
  },
  {
    name: "sessions",
    description: "Browse past sessions",
    value: "/sessions",
    action: (ctx) => {
      ctx.dialog.open({
        title: "Sessions",
        children: <SessionsDialogContent />,
      })
    },
  },
  {
    name: "theme",
    description: "Change color theme",
    value: "/theme",
    action: (ctx) => {
      ctx.dialog.open({
        title: "Select Theme",
        children: <ThemeDialogContent />,
      })
    },
  },
  {
    name: "login",
    description: "Sign in with your browser",
    value: "/login",
    action: async (ctx) => {
      const auth = getAuth();
      if (auth) {
        ctx.toast.show({ message: "Already signed in." });
        return;
      }
      ctx.toast.show({ message: "Opening browser to sign in..." });

      try {
        await performLogin();
        ctx.toast.show({ variant: "success", message: "Signed in" });
      } catch (error) {
        const message = error instanceof Error 
          ? error.message 
          : "Sign in failed or timed out";

        ctx.toast.show({ variant: "error", message });
      }
    },
  },
  {
    name: "logout",
    description: "Sign out of your account",
    value: "/logout",
    action: (ctx) => {
      clearAuth();
      ctx.toast.show({ variant: "success", message: "Signed out" });
    },
  },
  {
    name: "upgrade",
    description: "Buy more credits",
    value: "/upgrade",
    action: async (ctx) => {
      ctx.toast.show({ message: "Opening credits checkout..." });

      try {
        await openUpgradeCheckout();
        ctx.toast.show({
          variant: "success",
          message: "Checkout opened in browser",
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to open checkout";
        ctx.toast.show({ variant: "error", message });
      }
    },
  },
  {
    name: "usage",
    description: "Open billing portal in your browser",
    value: "/usage",
    action: async (ctx) => {
      ctx.toast.show({ message: "Opening billing portal..." });

      try {
        await openBillingPortal();
        ctx.toast.show({
          variant: "success",
          message: "Billing portal opened in browser",
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to open billing portal";
        ctx.toast.show({ variant: "error", message });
      }
    },
  },
  {
    name: "exit",
    description: "Quit the application",
    value: "/exit",
    action: (ctx) => {
      ctx.exit();
    },
  },
];