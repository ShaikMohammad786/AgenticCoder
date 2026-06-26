import { SUPPORTED_CHAT_MODELS } from "@agenticcoder/shared";
import { 
  AgentsDialogContent,
  ModelsDialogContent,
  SessionsDialogContent,
  ThemeDialogContent,
  McpDialogContent,
  CheckpointsDialogContent,
  OllamaDialogContent,
  PluginsDialogContent,
  SkillsDialogContent,
  DiffDialogContent,
} from "../dialogs";
import type { Command } from "./types";

import { performLogin } from "../../lib/oauth";
import { clearAuth, getAuth } from "../../lib/auth";
import { undoToLastCheckpoint, createCheckpoint } from "../../lib/checkpoint";

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
    name: "checkpoints",
    description: "View & restore saved checkpoints",
    value: "/checkpoints",
    action: (ctx) => {
      ctx.dialog.open({
        title: "Checkpoints",
        children: <CheckpointsDialogContent />,
      });
    },
  },
  {
    name: "checkpoint",
    description: "Create a manual checkpoint of current state",
    value: "/checkpoint",
    action: async (ctx) => {
      try {
        ctx.toast.show({ message: "Creating checkpoint..." });
        const id = await createCheckpoint();
        if (id) {
          ctx.toast.show({ variant: "success", message: "Checkpoint created ✓" });
        } else {
          ctx.toast.show({ message: "No changes to checkpoint" });
        }
      } catch (error) {
        ctx.toast.show({
          variant: "error",
          message: error instanceof Error ? error.message : "Checkpoint failed",
        });
      }
    },
  },
  {
    name: "restore",
    description: "Open checkpoints to select & restore",
    value: "/restore",
    action: (ctx) => {
      ctx.dialog.open({
        title: "Restore Checkpoint",
        children: <CheckpointsDialogContent />,
      });
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
        message: "Commands: /new /clear /undo /checkpoint /checkpoints /restore /commit /agents /models /ollama /skills /plugins /mcp /sessions /theme /config /diff /export /copy /login /logout /upgrade /usage /help /status /exit",
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
    name: "ollama",
    description: "Browse & select local Ollama models",
    value: "/ollama",
    action: (ctx) => {
      ctx.dialog.open({
        title: "Ollama Models",
        children: <OllamaDialogContent onSelectModel={ctx.setModel} />,
      });
    },
  },
  {
    name: "skills",
    description: "Browse & activate prompt skills",
    value: "/skills",
    action: (ctx) => {
      ctx.dialog.open({
        title: "Skills",
        children: (
          <SkillsDialogContent
            onSelectSkill={(skill) => {
              if (skill.mode) ctx.setMode(skill.mode);
              // Inject skill prompt into the input bar
              if (ctx.setInputText) ctx.setInputText(skill.prompt);
            }}
          />
        ),
      });
    },
  },
  {
    name: "plugins",
    description: "View installed plugins",
    value: "/plugins",
    action: (ctx) => {
      ctx.dialog.open({
        title: "Plugins",
        children: <PluginsDialogContent />,
      });
    },
  },
  {
    name: "plugin install",
    description: "Install a plugin from GitHub, npm, or URL",
    value: "/plugin install",
    action: async (ctx) => {
      ctx.toast.show({ message: "Usage: type the source after the command\ne.g. /plugin install github:user/repo" });
      ctx.setInputText?.("/plugin install ");
    },
  },
  {
    name: "plugin remove",
    description: "Remove an installed plugin",
    value: "/plugin remove",
    action: async (ctx) => {
      ctx.toast.show({ message: "Usage: type plugin name after the command\ne.g. /plugin remove my-plugin" });
      ctx.setInputText?.("/plugin remove ");
    },
  },
  {
    name: "plugin update",
    description: "Update an installed plugin to latest version",
    value: "/plugin update",
    action: async (ctx) => {
      ctx.toast.show({ message: "Usage: type plugin name after the command\ne.g. /plugin update my-plugin" });
      ctx.setInputText?.("/plugin update ");
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
    name: "mcp",
    description: "View MCP servers and tools",
    value: "/mcp",
    action: (ctx) => {
      ctx.dialog.open({
        title: "MCP Servers",
        children: <McpDialogContent onAskAi={(query) => {
          if (ctx.setInputText) {
            ctx.setInputText(`Find and install the official MCP server for '${query}'`);
          }
        }} />,
      });
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
  {
    name: "config",
    description: "Open AGENT.md project instructions",
    value: "/config",
    action: async (ctx) => {
      const { existsSync, mkdirSync, writeFileSync } = await import("fs");
      const { join } = await import("path");
      const dir = join(process.cwd(), ".agenticcoder");
      const filePath = join(dir, "AGENT.md");

      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      if (!existsSync(filePath)) {
        writeFileSync(filePath, "# Project Instructions\n\nDescribe your project conventions, tech stack, and preferences here.\nThis file is automatically injected into every AI conversation.\n", "utf8");
      }

      // Open in default editor
      const editor = process.env.EDITOR || (process.platform === "win32" ? "notepad" : "nano");
      try {
        Bun.spawn([editor, filePath], { stdout: "inherit", stderr: "inherit" });
        ctx.toast.show({ message: `Opened ${filePath}` });
      } catch {
        ctx.toast.show({ variant: "error", message: `Created ${filePath} — open it manually` });
      }
    },
  },
  {
    name: "diff",
    description: "Show all changes since session started",
    value: "/diff",
    action: (ctx) => {
      ctx.dialog.open({
        title: "Changes",
        children: <DiffDialogContent />,
      });
    },
  },
  {
    name: "copy",
    description: "Copy last AI response to clipboard",
    value: "/copy",
    action: async (ctx) => {
      try {
        const clipCmd = process.platform === "win32" ? "clip" : process.platform === "darwin" ? "pbcopy" : "xclip -sel clipboard";
        ctx.toast.show({ message: "Use Ctrl+Shift+C to copy from terminal" });
      } catch {
        ctx.toast.show({ variant: "error", message: "Copy failed" });
      }
    },
  },
  {
    name: "export",
    description: "Export conversation as markdown file",
    value: "/export",
    action: async (ctx) => {
      try {
        const { writeFileSync } = await import("fs");
        const { join } = await import("path");
        const { apiClient } = await import("../../lib/api-client");

        if (!ctx.sessionId) {
          ctx.toast.show({ variant: "error", message: "No active session to export" });
          return;
        }

        ctx.toast.show({ message: "Exporting session..." });

        const res = await apiClient.sessions[":id"].$get({ param: { id: ctx.sessionId } });
        if (!res.ok) {
          ctx.toast.show({ variant: "error", message: "Failed to fetch session" });
          return;
        }

        const session = await res.json() as { id: string; title?: string; messages?: unknown[] };
        const messages = (session.messages ?? []) as Array<{
          role: string;
          parts: Array<{ type: string; text?: string; toolName?: string; input?: unknown; output?: string }>;
          metadata?: { mode?: string; model?: string };
        }>;

        // Convert to markdown
        const lines: string[] = [
          `# Session: ${session.title || session.id}`,
          `> Exported at ${new Date().toLocaleString()}`,
          "",
        ];

        for (const msg of messages) {
          if (msg.role === "user") {
            const text = msg.parts.filter(p => p.type === "text").map(p => p.text ?? "").join("");
            lines.push(`## User`, "", text, "");
          } else if (msg.role === "assistant") {
            const mode = msg.metadata?.mode ?? "BUILD";
            const model = msg.metadata?.model ?? "";
            lines.push(`## Assistant (${mode} · ${model})`, "");
            for (const part of msg.parts) {
              if (part.type === "text" && part.text) {
                lines.push(part.text, "");
              } else if (part.type === "reasoning" && part.text) {
                lines.push(`<details><summary>Thinking</summary>\n\n${part.text}\n\n</details>`, "");
              } else if (part.toolName) {
                lines.push(`> 🔧 **${part.toolName}**`, "");
              }
            }
          }
        }

        const filename = `session-export-${Date.now()}.md`;
        const filePath = join(process.cwd(), filename);
        writeFileSync(filePath, lines.join("\n"), "utf8");
        ctx.toast.show({ variant: "success", message: `Exported to ${filename}` });
      } catch (err) {
        ctx.toast.show({
          variant: "error",
          message: err instanceof Error ? err.message : "Export failed",
        });
      }
    },
  },
];