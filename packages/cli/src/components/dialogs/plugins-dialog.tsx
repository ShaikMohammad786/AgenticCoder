import { useState, useEffect, useCallback } from "react";
import { TextAttributes } from "@opentui/core";
import { useDialog } from "../../providers/dialog";
import { useToast } from "../../providers/toast";
import { useTheme } from "../../providers/theme";
import { DialogSearchList } from "../dialog-search-list";
import { loadPlugins, type Plugin } from "../../lib/plugins";

type PluginItem = Plugin & { displayName: string };

export const PluginsDialogContent = () => {
  const dialog = useDialog();
  const toast = useToast();
  const { colors } = useTheme();
  const [items, setItems] = useState<PluginItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let ignore = false;
    (async () => {
      const plugins = await loadPlugins();
      if (ignore) return;
      setItems(
        plugins.map((p) => ({
          ...p,
          displayName: p.name,
        }))
      );
      setLoading(false);
    })();
    return () => { ignore = true; };
  }, []);

  const handleSelect = useCallback(
    (item: PluginItem) => {
      dialog.close();
      toast.show({
        message: `Plugin "${item.name}" (${item.handlerType})\n${item.description}\nHandler: ${item.handlerPath}`,
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
          Create a plugin:{"\n"}
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
        item.description.toLowerCase().includes(query.toLowerCase())
      }
      renderItem={(item, isSelected) => (
        <text selectable={false} fg={isSelected ? "black" : "white"}>
          {"  " + item.name.padEnd(20) + `[${item.handlerType}]  ` + item.description}
        </text>
      )}
      getKey={(item) => item.name}
      placeholder="Search plugins"
      emptyText="No matching plugins"
    />
  );
};
