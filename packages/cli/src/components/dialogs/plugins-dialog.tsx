import { useState, useEffect, useCallback } from "react";
import { TextAttributes } from "@opentui/core";
import { useDialog } from "../../providers/dialog";
import { useToast } from "../../providers/toast";
import { useTheme } from "../../providers/theme";
import { DialogSearchList } from "../dialog-search-list";
import { SecretInputDialogContent } from "./secret-input-dialog";
import { missingEnvVars, setProjectEnvValue } from "../../lib/env-file";
import { loadPlugins, type Plugin } from "../../lib/plugins";
import { installPlugin, listInstalledPlugins } from "../../lib/plugin-registry";
import { installCatalogPlugin, PLUGIN_CATALOG, type PluginCatalogEntry } from "../../lib/plugin-catalog";

type InstalledPluginItem = Plugin & {
  kind: "installed";
  displayName: string;
  sourceLabel: string;
  hasSource: boolean;
};

type AvailablePluginItem = PluginCatalogEntry & {
  kind: "available";
  displayName: string;
  sourceLabel: string;
  handlerType: "typescript";
};

type ExternalPluginItem = {
  kind: "external";
  name: string;
  displayName: string;
  description: string;
  sourceLabel: string;
  handlerType: "typescript";
  source: string;
};

type PluginItem = InstalledPluginItem | AvailablePluginItem | ExternalPluginItem;

export const PluginsDialogContent = () => {
  const dialog = useDialog();
  const toast = useToast();
  const { colors } = useTheme();
  const [items, setItems] = useState<PluginItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    let ignore = false;
    (async () => {
      // Load both raw plugins and registry metadata
      const [plugins, installed] = await Promise.all([
        loadPlugins(),
        listInstalledPlugins(),
      ]);

      if (ignore) return;

      // Merge: match by name for source info
      const installedMap = new Map(installed.map(p => [p.name, p]));

      const installedNames = new Set(plugins.map((p) => p.name));
      const installedItems: InstalledPluginItem[] =
        plugins.map((p) => {
          const meta = installedMap.get(p.name);
          let sourceLabel = "local";
          let hasSource = false;

          if (meta?.source) {
            hasSource = meta.source.raw !== "local";
            if (meta.source.type === "github") {
              sourceLabel = `github:${meta.source.owner}/${meta.source.repo}`;
            } else if (meta.source.type === "npm") {
              sourceLabel = `npm:${meta.source.packageName}`;
            } else if (meta.source.type === "url" && meta.source.raw !== "local") {
              sourceLabel = "url";
            }
          }

          return {
            ...p,
            kind: "installed" as const,
            displayName: p.name,
            sourceLabel,
            hasSource,
          };
        });

      const catalogItems: AvailablePluginItem[] = PLUGIN_CATALOG
        .filter((entry) => !installedNames.has(entry.name))
        .map((entry) => ({
          ...entry,
          kind: "available" as const,
          displayName: entry.name,
          sourceLabel: "built-in catalog",
          handlerType: "typescript" as const,
        }));

      setItems([...installedItems, ...catalogItems]);
      setLoading(false);
    })();
    return () => { ignore = true; };
  }, []);

  const handleSelect = useCallback(
    async (item: PluginItem) => {
      if (item.kind === "external") {
        const result = await installPlugin(item.source);
        toast.show({
          variant: result.success ? "success" : "error",
          message: result.message,
          duration: 4000,
        });
        dialog.close();
        return;
      }

      if (item.kind === "available") {
        const result = installCatalogPlugin(item);
        toast.show({
          variant: result.success ? "success" : "error",
          message: result.message,
          duration: 4000,
        });
        dialog.close();
        return;
      }

      const requiredEnv = Object.keys(item.env ?? {});
      const missing = missingEnvVars(requiredEnv);

      if (missing.length > 0) {
        const envName = missing[0]!;
        dialog.open({
          title: `${item.name} Setup`,
          children: (
            <SecretInputDialogContent
              label={`Enter ${envName}`}
              envName={envName}
              description={`This value will be saved in .env and used by the ${item.name} plugin.`}
              placeholder={envName}
              onSubmit={(value) => {
                setProjectEnvValue(envName, value);
                toast.show({
                  variant: "success",
                  message: `Saved ${envName} for ${item.name}.`,
                });
                dialog.close();
              }}
            />
          ),
        });
        return;
      }

      const actions: string[] = [`Plugin: ${item.name}`, `Type: ${item.handlerType}`, `Source: ${item.sourceLabel}`, item.description];

      toast.show({
        message: actions.join("\n"),
      });
      dialog.close();
    },
    [dialog, toast],
  );

  if (loading) {
    return (
      <box paddingX={2} paddingY={1}>
        <text attributes={TextAttributes.DIM}>Loading plugins...</text>
      </box>
    );
  }

  const finalItems = [...items];
  const trimmedQuery = searchQuery.trim();
  if (/^(npm:|github:|https?:\/\/)/.test(trimmedQuery)) {
    finalItems.push({
      kind: "external",
      name: `install-${trimmedQuery}`,
      displayName: `Install ${trimmedQuery}`,
      description: "Install external AgenticCoder plugin source",
      sourceLabel: trimmedQuery,
      handlerType: "typescript",
      source: trimmedQuery,
    });
  }

  return (
    <DialogSearchList
      items={finalItems}
      onSelect={handleSelect}
      onSearchChange={setSearchQuery}
      filterFn={(item, query) =>
        item.kind === "external" ||
        item.name.toLowerCase().includes(query.toLowerCase()) ||
        item.description.toLowerCase().includes(query.toLowerCase()) ||
        item.sourceLabel.toLowerCase().includes(query.toLowerCase())
      }
      renderItem={(item, isSelected) => (
        <text selectable={false} fg={isSelected ? "black" : "white"}>
          {"  " + (item.kind === "installed" ? "● " : "+ ") + item.name.padEnd(18) + `[${item.handlerType}]`.padEnd(14) + `(${item.sourceLabel})`.padEnd(28) + item.description}
        </text>
      )}
      getKey={(item) => item.name}
      placeholder="Search plugins, or use npm:pkg / github:owner/repo"
      emptyText="No matching plugins"
    />
  );
};
