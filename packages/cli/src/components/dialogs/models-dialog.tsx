import { useCallback } from "react";
import { TextAttributes } from "@opentui/core";
import { useDialog } from "../../providers/dialog";
import { useTheme } from "../../providers/theme";
import { DialogSearchList } from "../dialog-search-list";
import { SUPPORTED_CHAT_MODELS, type SupportedChatModelId } from "@agenticcoder/shared";
import { usePromptConfig } from "../../providers/prompt-config";

type ModelsDialogContentProps = {
  models: SupportedChatModelId[];
  onSelectModel: (modelId: SupportedChatModelId) => void;
};

function getModelDisplayName(id: string): { name: string; provider: string } {
  const model = SUPPORTED_CHAT_MODELS.find(m => m.id === id);
  if (!model) return { name: id, provider: "" };
  // Extract provider from id like "google/gemini-2.0-flash" -> "google"
  const provider = id.split("/")[0] ?? "";
  const name = id.split("/").slice(1).join("/") || id;
  return { name, provider };
}

export const ModelsDialogContent = ({ 
  models, 
  onSelectModel 
}: ModelsDialogContentProps) => {
  const dialog = useDialog();
  const { colors } = useTheme();
  const { model: currentModel } = usePromptConfig();

  const handleSelect = useCallback(
    (modelId: SupportedChatModelId) => {
      onSelectModel(modelId);
      dialog.close();
    },
    [dialog, onSelectModel],
  );

  return (
    <DialogSearchList
      items={models}
      onSelect={handleSelect}
      filterFn={(modelId, query) => modelId.toLowerCase().includes(query.toLowerCase())}
      renderItem={(modelId, isSelected) => {
        const { name, provider } = getModelDisplayName(modelId);
        const isCurrent = modelId === currentModel;
        return (
          <box flexDirection="row" gap={1}>
            <text selectable={false} fg={isSelected ? "black" : "white"}>
              {isCurrent ? " ◉ " : " ○ "}
              {name}
            </text>
            <text 
              selectable={false} 
              attributes={TextAttributes.DIM} 
              fg={isSelected ? "black" : colors.dimSeparator}
            >
              {provider}
            </text>
          </box>
        );
      }}
      getKey={(modelId) => modelId}
      placeholder="Search models"
      emptyText="No matching models"
    />
  );
};