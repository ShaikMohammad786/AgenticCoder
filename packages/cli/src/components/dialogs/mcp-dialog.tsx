import { useState, useEffect, useCallback } from "react";
import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useDialog } from "../../providers/dialog";
import { useTheme } from "../../providers/theme";
import { DialogSearchList } from "../dialog-search-list";
import {
  initializeMcp,
  getMcpStatus,
  hasMcpConfig,
} from "../../lib/mcp-client";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// Popular MCP server catalog
const MCP_CATALOG = [
  {
    id: "filesystem",
    label: "Filesystem",
    description: "Read, write, and manage files",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
    needsKey: false,
  },
  {
    id: "github",
    label: "GitHub",
    description: "Manage repos, issues, PRs",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    env: { GITHUB_TOKEN: "" },
    needsKey: true,
    setupUrl: "https://github.com/settings/tokens/new",
  },
  {
    id: "brave-search",
    label: "Brave Search",
    description: "Web search via Brave API",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-brave-search"],
    env: { BRAVE_API_KEY: "" },
    needsKey: true,
    setupUrl: "https://brave.com/search/api/",
  },
  {
    id: "postgres",
    label: "PostgreSQL",
    description: "Query your database",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres"],
    env: { DATABASE_URL: "" },
    needsKey: true,
  },
  {
    id: "memory",
    label: "Memory",
    description: "Persistent knowledge graph",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
    needsKey: false,
  },
  {
    id: "puppeteer",
    label: "Puppeteer",
    description: "Browser automation + screenshots",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-puppeteer"],
    needsKey: false,
  },
];

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
};

export const McpDialogContent = ({ onClose }: McpDialogContentProps) => {
  const dialog = useDialog();
  const { colors } = useTheme();
  const [items, setItems] = useState<McpListItem[]>([]);
  const [loading, setLoading] = useState(true);

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

      // Only try connecting if config exists — with a timeout so UI never hangs
      if (hasMcpConfig()) {
        try {
          await Promise.race([
            initializeMcp(),
            new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
          ]);
        } catch {}
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
          result.push({
            id: name,
            label: name,
            description: "Configured but not connected",
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

  const handleSelect = useCallback(async (item: McpListItem) => {
    if (item.status === "connected") {
      // Already connected - just show toast or info
      dialog.close();
      return;
    }

    if (item.status === "available" && item.catalogEntry) {
      const catalog = item.catalogEntry;

      // Write to mcp.json
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
      if ("env" in catalog && catalog.env) {
        entry.env = catalog.env;
      }
      config.mcpServers[catalog.id] = entry;

      mkdirSync(configDir, { recursive: true });
      writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");

      // Open setup URL if needed
      if ("setupUrl" in catalog && catalog.setupUrl) {
        try {
          const open = await import("open");
          await open.default(catalog.setupUrl);
        } catch {}
      }

      dialog.close();
      return;
    }

    dialog.close();
  }, [dialog]);

  if (loading) {
    return (
      <box flexDirection="column">
        <text fg={colors.primary}>{"Connecting to MCP servers..."}</text>
      </box>
    );
  }

  return (
    <DialogSearchList
      items={items}
      onSelect={handleSelect}
      filterFn={(item, query) =>
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
      placeholder="Search MCP servers"
      emptyText="No matching servers"
    />
  );
};
