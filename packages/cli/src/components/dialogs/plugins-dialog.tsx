import { useState, useEffect, useCallback } from "react";
import { TextAttributes } from "@opentui/core";
import { useDialog } from "../../providers/dialog";
import { useToast } from "../../providers/toast";
import { useTheme } from "../../providers/theme";
import { DialogSearchList } from "../dialog-search-list";
import { loadPlugins, type Plugin } from "../../lib/plugins";
import { listInstalledPlugins, removePlugin, updatePlugin, type InstalledPlugin } from "../../lib/plugin-registry";

type PluginItem = Plugin & {
  displayName: string;
  sourceLabel: string;
  hasSource: boolean;
};

export const PluginsDialogContent = () => {
  const dialog = useDialog();
  const toast = useToast();
  const { colors } = useTheme();
  const [items, setItems] = useState<PluginItem[]>([]);
  const [loading, setLoading] = useState(true);

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

      setItems(
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
            displayName: p.name,
            sourceLabel,
            hasSource,
          };
        })
      );
      setLoading(false);
    })();
    return () => { ignore = true; };
  }, []);

  const handleSelect = useCallback(
    async (item: PluginItem) => {
      dialog.close();

      const actions: string[] = [`Plugin: ${item.name}`, `Type: ${item.handlerType}`, `Source: ${item.sourceLabel}`, item.description];

      toast.show({
        message: actions.join("\n"),
      });
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

  if (items.length === 0) {
    return (
      <box paddingX={2} paddingY={1} flexDirection="column" gap={1}>
        <text fg="yellow">No plugins found</text>
        <text attributes={TextAttributes.DIM}>
          Install a plugin:{"\n"}
          /plugin install github:user/repo{"\n"}
          /plugin install npm:package-name{"\n"}
          {"\n"}
          Or create one manually:{"\n"}
          .agenticcoder/plugins/my-tool/plugin.json{"\n"}
          .agenticcoder/plugins/my-tool/handler.sh
        </text>
      </box>
    );
  }

  return (
    <DialogSearchList
      items={items}
      onSelect={handleSelect}
      filterFn={(item, query) =>
        item.name.toLowerCase().includes(query.toLowerCase()) ||
        item.description.toLowerCase().includes(query.toLowerCase()) ||
        item.sourceLabel.toLowerCase().includes(query.toLowerCase())
      }
      renderItem={(item, isSelected) => (
        <text selectable={false} fg={isSelected ? "black" : "white"}>
          {"  " + item.name.padEnd(18) + `[${item.handlerType}]`.padEnd(14) + `(${item.sourceLabel})`.padEnd(28) + item.description}
        </text>
      )}
      getKey={(item) => item.name}
      placeholder="Search plugins (name, source)"
      emptyText="No matching plugins"
    />
  );
};
