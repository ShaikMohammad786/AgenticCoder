import { useState, useEffect, useCallback } from "react";
import { TextAttributes } from "@opentui/core";
import { useDialog } from "../../providers/dialog";
import { useToast } from "../../providers/toast";
import { useTheme } from "../../providers/theme";
import { DialogSearchList } from "../dialog-search-list";
import {
  isOllamaAvailable,
  listOllamaModels,
  formatModelSize,
  type OllamaModel,
} from "../../lib/ollama";

type OllamaItem = {
  name: string;
  size: string;
  rawSize: number;
};

type Props = {
  onSelectModel: (modelId: string) => void;
};

export const OllamaDialogContent = ({ onSelectModel }: Props) => {
  const dialog = useDialog();
  const toast = useToast();
  const { colors } = useTheme();
  const [items, setItems] = useState<OllamaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    let ignore = false;
    (async () => {
      const ok = await isOllamaAvailable();
      if (ignore) return;
      if (!ok) {
        setAvailable(false);
        setLoading(false);
        return;
      }

      const models = await listOllamaModels();
      if (ignore) return;
      setItems(
        models.map((m) => ({
          name: m.name,
          size: formatModelSize(m.size),
          rawSize: m.size,
        }))
      );
      setLoading(false);
    })();
    return () => { ignore = true; };
  }, []);

  const handleSelect = useCallback(
    (item: OllamaItem) => {
      const modelId = `ollama:${item.name}`;
      onSelectModel(modelId);
      dialog.close();
      toast.show({ variant: "success", message: `Switched to Ollama: ${item.name}` });
    },
    [dialog, toast, onSelectModel],
  );

  if (loading) {
    return (
      <box paddingX={2} paddingY={1}>
        <text attributes={TextAttributes.DIM}>Detecting Ollama...</text>
      </box>
    );
  }

  if (!available) {
    return (
      <box paddingX={2} paddingY={1} flexDirection="column" gap={1}>
        <text fg="yellow">Ollama not detected on localhost:11434</text>
        <text attributes={TextAttributes.DIM}>
          Install: https://ollama.com/download{"\n"}
          Then run: ollama serve
        </text>
      </box>
    );
  }

  if (items.length === 0) {
    return (
      <box paddingX={2} paddingY={1} flexDirection="column" gap={1}>
        <text fg="yellow">No Ollama models found</text>
        <text attributes={TextAttributes.DIM}>
          Pull a model: ollama pull codellama:7b
        </text>
      </box>
    );
  }

  return (
    <DialogSearchList
      items={items}
      onSelect={handleSelect}
      filterFn={(item, query) =>
        item.name.toLowerCase().includes(query.toLowerCase())
      }
      renderItem={(item, isSelected) => (
        <text selectable={false} fg={isSelected ? "black" : "white"}>
          {"  " + item.name.padEnd(30) + item.size}
        </text>
      )}
      getKey={(item) => item.name}
      placeholder="Search Ollama models"
      emptyText="No matching models"
    />
  );
};
