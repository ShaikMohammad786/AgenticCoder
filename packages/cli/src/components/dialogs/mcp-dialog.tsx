import { useState, useEffect, useCallback } from "react";
import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useDialog } from "../../providers/dialog";
import { useToast } from "../../providers/toast";
import { useTheme } from "../../providers/theme";
import { DialogSearchList } from "../dialog-search-list";
import { SecretInputDialogContent } from "./secret-input-dialog";
import {
  initializeMcp,
  getMcpStatus,
  hasMcpConfig,
} from "../../lib/mcp-client";
import { missingEnvVars, setProjectEnvValue } from "../../lib/env-file";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

type McpCatalogEntry = {
  id: string;
  label: string;
  description: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  needsKey: boolean;
  setupUrl?: string;
};

function npxServer(...args: string[]) {
  return process.platform === "win32"
    ? { command: "cmd", args: ["/c", "npx", ...args] }
    : { command: "npx", args };
}

function uvxServer(...args: string[]) {
  return { command: "uvx", args };
}

// Popular MCP server catalog
const MCP_CATALOG: McpCatalogEntry[] = [
  {
    id: "filesystem",
    label: "Filesystem",
    description: "Read, write, and manage files",
    ...npxServer("-y", "@modelcontextprotocol/server-filesystem", "."),
    needsKey: false,
  },
  {
    id: "memory",
    label: "Memory",
    description: "Persistent knowledge graph",
    ...npxServer("-y", "@modelcontextprotocol/server-memory"),
    needsKey: false,
  },
  {
    id: "sequential-thinking",
    label: "Sequential Thinking",
    description: "Structured multi-step reasoning",
    ...npxServer("-y", "@modelcontextprotocol/server-sequential-thinking"),
    needsKey: false,
  },
  {
    id: "context7",
    label: "Context7",
    description: "Up-to-date library documentation",
    ...npxServer("-y", "@upstash/context7-mcp"),
    needsKey: false,
  },
  {
    id: "playwright",
    label: "Playwright",
    description: "Browser automation, snapshots, and tests",
    ...npxServer("-y", "@playwright/mcp@latest", "--output-dir", ".agenticcoder/playwright-output"),
    needsKey: false,
  },
  {
    id: "puppeteer",
    label: "Puppeteer",
    description: "Browser automation + screenshots",
    ...npxServer("-y", "@modelcontextprotocol/server-puppeteer"),
    needsKey: false,
  },
  {
    id: "fetch",
    label: "Fetch",
    description: "Fetch and convert web content",
    ...uvxServer("mcp-server-fetch"),
    needsKey: false,
  },
  {
    id: "git",
    label: "Git",
    description: "Read and inspect Git repositories",
    ...uvxServer("mcp-server-git"),
    needsKey: false,
  },
  {
    id: "time",
    label: "Time",
    description: "Timezone and time conversion tools",
    ...uvxServer("mcp-server-time", "--local-timezone=Asia/Kolkata"),
    needsKey: false,
  },
  {
    id: "github",
    label: "GitHub",
    description: "Manage repos, issues, PRs",
    command: "docker",
    args: [
      "run",
      "-i",
      "--rm",
      "-e",
      "GITHUB_PERSONAL_ACCESS_TOKEN",
      "ghcr.io/github/github-mcp-server",
    ],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: "" },
    needsKey: true,
    setupUrl: "https://github.com/settings/personal-access-tokens/new",
  },
  {
    id: "brave-search",
    label: "Brave Search",
    description: "Web search via Brave API",
    ...npxServer("-y", "@brave/brave-search-mcp-server"),
    env: { BRAVE_API_KEY: "" },
    needsKey: true,
    setupUrl: "https://brave.com/search/api/",
  },
  {
    id: "postgres",
    label: "PostgreSQL",
    description: "Query your database",
    ...npxServer("-y", "@modelcontextprotocol/server-postgres"),
    env: { DATABASE_URL: "" },
    needsKey: true,
  },
  {
    id: "sqlite",
    label: "SQLite",
    description: "Inspect and query a local SQLite database",
    ...npxServer("-y", "@modelcontextprotocol/server-sqlite", ".agenticcoder/sqlite.db"),
    needsKey: false,
  },
  {
    id: "slack",
    label: "Slack",
    description: "Read and search Slack workspace data",
    ...npxServer("-y", "@modelcontextprotocol/server-slack"),
    env: { SLACK_BOT_TOKEN: "", SLACK_TEAM_ID: "" },
    needsKey: true,
    setupUrl: "https://api.slack.com/apps",
  },
  {
    id: "google-maps",
    label: "Google Maps",
    description: "Places, geocoding, and location lookup",
    ...npxServer("-y", "@modelcontextprotocol/server-google-maps"),
    env: { GOOGLE_MAPS_API_KEY: "" },
    needsKey: true,
    setupUrl: "https://console.cloud.google.com/google/maps-apis",
  },
  {
    id: "google-drive",
    label: "Google Drive",
    description: "Search and read Google Drive files",
    ...npxServer("-y", "@modelcontextprotocol/server-gdrive"),
    needsKey: true,
  },
  {
    id: "docker",
    label: "Docker",
    description: "Manage containers and images",
    ...npxServer("-y", "@docker/mcp-server"),
    needsKey: false,
  },
  {
    id: "kubernetes",
    label: "Kubernetes",
    description: "Manage K8s clusters",
    ...npxServer("-y", "@strowk/mcp-k8s-go"),
    needsKey: false,
  },
  {
    id: "aws",
    label: "AWS",
    description: "Interact with AWS resources",
    ...npxServer("-y", "@aws/mcp-server"),
    needsKey: false,
  },
  {
    id: "everything",
    label: "Everything",
    description: "MCP protocol test server with prompts/resources/tools",
    ...npxServer("-y", "@modelcontextprotocol/server-everything"),
    needsKey: false,
  },
];

function addMcpServer(catalog: McpCatalogEntry) {
  const root = process.cwd();
  const configDir = join(root, ".agenticcoder");
  const configPath = join(configDir, "mcp.json");

  let config: { mcpServers: Record<string, any> } = { mcpServers: {} };
  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, "utf8"));
      if (!config.mcpServers) config.mcpServers = {};
    } catch {
      config = { mcpServers: {} };
    }
  }

  const entry: Record<string, any> = {
    command: catalog.command,
    args: catalog.args,
  };
  if (catalog.env) {
    entry.env = Object.fromEntries(
      Object.keys(catalog.env).map((name) => [name, ""]),
    );
  }
  config.mcpServers[catalog.id] = entry;

  mkdirSync(configDir, { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
}

type McpListItem = {
  id: string;
  label: string;
  description: string;
  status: "connected" | "configured" | "available";
  toolCount: number;
  needsKey: boolean;
  catalogEntry?: typeof MCP_CATALOG[number];
};

type McpDialogContentProps = {
  onClose?: () => void;
  onAskAi?: (query: string) => void;
};

export const McpDialogContent = ({ onClose, onAskAi }: McpDialogContentProps) => {
  const dialog = useDialog();
  const toast = useToast();
  const { colors } = useTheme();
  const [items, setItems] = useState<McpListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  // ESC to close during loading state (DialogSearchList handles its own ESC)
  useKeyboard((key) => {
    if (key.name === "escape") {
      dialog.close();
    }
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      const result: McpListItem[] = [];
      const initErrors = new Map<string, string>();

      // Only try connecting if config exists — with a timeout so UI never hangs
      if (hasMcpConfig()) {
        try {
          const initResult = await initializeMcp();
          for (const error of initResult.errors) {
            const separatorIndex = error.indexOf(":");
            if (separatorIndex === -1) continue;
            const serverName = error.slice(0, separatorIndex).trim();
            const message = error.slice(separatorIndex + 1).trim().split("\n")[0] || "Failed to connect";
            initErrors.set(serverName, message);
          }
        } catch (error) {
          initErrors.set("all", error instanceof Error ? error.message : String(error));
        }
      }
      const connectedServers = getMcpStatus();
      const connectedNames = new Set(connectedServers.map((s) => s.name));

      // Get configured but not connected servers
      let configuredNames = new Set<string>();
      try {
        const configPath = join(process.cwd(), ".agenticcoder", "mcp.json");
        if (existsSync(configPath)) {
          const config = JSON.parse(readFileSync(configPath, "utf8"));
          configuredNames = new Set(Object.keys(config.mcpServers ?? {}));
        }
      } catch {}

      // Add connected servers
      for (const server of connectedServers) {
        result.push({
          id: server.name,
          label: server.name,
          description: server.toolCount + " tools connected",
          status: "connected",
          toolCount: server.toolCount,
          needsKey: false,
        });
      }

      // Add configured but not connected
      for (const name of configuredNames) {
        if (!connectedNames.has(name)) {
          const error = initErrors.get(name) || initErrors.get("all");
          result.push({
            id: name,
            label: name,
            description: error ? `Not connected: ${error}` : "Configured but not connected",
            status: "configured",
            toolCount: 0,
            needsKey: false,
          });
        }
      }

      // Add available from catalog
      for (const entry of MCP_CATALOG) {
        if (!connectedNames.has(entry.id) && !configuredNames.has(entry.id)) {
          result.push({
            id: entry.id,
            label: entry.label,
            description: entry.description + (entry.needsKey ? " (needs API key)" : ""),
            status: "available",
            toolCount: 0,
            needsKey: entry.needsKey,
            catalogEntry: entry,
          });
        }
      }

      if (!cancelled) {
        setItems(result);
        setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  const promptForMcpEnv = useCallback((catalog: McpCatalogEntry, missing: string[], index = 0) => {
    const envName = missing[index];
    if (!envName) {
      addMcpServer(catalog);
      toast.show({
        variant: "success",
        message: `Saved required env and added ${catalog.label}. Restart the session if it is already running.`,
        duration: 4000,
      });
      dialog.close();
      return;
    }

    dialog.open({
      title: `${catalog.label} Setup`,
      children: (
        <SecretInputDialogContent
          label={`Enter ${envName}`}
          envName={envName}
          description={`This value will be saved in .env and used by ${catalog.label}.`}
          placeholder={envName}
          onSubmit={(value) => {
            setProjectEnvValue(envName, value);
            promptForMcpEnv(catalog, missing, index + 1);
          }}
        />
      ),
    });
  }, [dialog, toast]);

  const handleSelect = useCallback(async (item: McpListItem) => {
    if (item.status === "connected") {
      // Already connected - just show toast or info
      dialog.close();
      return;
    }

    if (item.status === "available") {
      let catalog = item.catalogEntry;
      
      // If it's a custom dynamic item
      if (item.id === "custom_search" && searchQuery) {
        catalog = {
          id: searchQuery.replace(/[^a-zA-Z0-9-]/g, "-"),
          label: searchQuery,
          description: "Custom MCP server",
          command: "npx",
          args: ["-y", searchQuery],
          needsKey: false,
        };
      }

      if (!catalog) {
        dialog.close();
        return;
      }

      const requiredEnv = Object.keys(catalog.env ?? {});
      const missing = missingEnvVars(requiredEnv);

      if (missing.length > 0) {
        promptForMcpEnv(catalog, missing);
        return;
      }

      addMcpServer(catalog);
      toast.show({
        variant: "success",
        message: `Added ${catalog.label} to MCP config. You may need to restart the session.`,
        duration: 4000
      });

      dialog.close();
      return;
    }

    if (item.id === "ask_ai" && onAskAi && searchQuery) {
      dialog.close();
      onAskAi(searchQuery);
      return;
    }

    dialog.close();
  }, [dialog, searchQuery, toast, onAskAi, promptForMcpEnv]);

  if (loading) {
    return (
      <box flexDirection="column">
        <text fg={colors.primary}>{"Connecting to MCP servers..."}</text>
      </box>
    );
  }

  // Dynamically add a "custom install" option if typing
  const finalItems = [...items];
  if (
    searchQuery &&
    !items.some((i) => i.label.toLowerCase() === searchQuery.toLowerCase())
  ) {
    if (onAskAi) {
      finalItems.push({
        id: "ask_ai",
        label: `Ask AI to find: ${searchQuery}`,
        description: "Let the agent search for the correct official MCP server",
        status: "available",
        toolCount: 0,
        needsKey: false,
      });
    }

    finalItems.push({
      id: "custom_search",
      label: `Force install: ${searchQuery}`,
      description: `Run (npx -y ${searchQuery}) without validation`,
      status: "available",
      toolCount: 0,
      needsKey: false,
    });
  }

  return (
    <DialogSearchList
      items={finalItems}
      onSelect={handleSelect}
      onSearchChange={setSearchQuery}
      filterFn={(item, query) =>
        item.id === "custom_search" ||
        item.label.toLowerCase().includes(query.toLowerCase()) ||
        item.description.toLowerCase().includes(query.toLowerCase())
      }
      renderItem={(item, isSelected) => {
        const icon = item.status === "connected" ? "● " 
          : item.status === "configured" ? "◐ " 
          : "+ ";
        const color = item.status === "connected" ? "green"
          : item.status === "configured" ? "yellow"
          : isSelected ? "black" : colors.primary;
        return (
          <text selectable={false} fg={isSelected ? "black" : "white"}>
            {icon + item.label + "  " + item.description}
          </text>
        );
      }}
      getKey={(item) => item.id}
      placeholder="Search or enter npm package name..."
      emptyText="No matching servers"
    />
  );
};
