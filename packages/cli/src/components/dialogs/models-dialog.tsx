import { useCallback } from "react";
import { TextAttributes } from "@opentui/core";
import { useDialog } from "../../providers/dialog";
import { useTheme } from "../../providers/theme";
import { DialogSearchList } from "../dialog-search-list";
import {
  SUPPORTED_CHAT_MODELS,
  type SupportedChatModel,
  type SupportedChatModelId,
  type SupportedProvider,
} from "@agenticcoder/shared";
import { usePromptConfig } from "../../providers/prompt-config";

type ModelsDialogContentProps = {
  models: SupportedChatModelId[];
  onSelectModel: (modelId: SupportedChatModelId) => void;
};

type ModelRow =
  | { type: "provider"; provider: SupportedProvider; label: string; count: number }
  | { type: "model"; model: SupportedChatModel; name: string; providerLabel: string };

const PROVIDER_LABELS: Record<SupportedProvider, string> = {
  openrouter: "OpenRouter",
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini AI Studio",
  groq: "Groq",
  together: "Together AI",
  fireworks: "Fireworks",
  cerebras: "Cerebras",
  deepseek: "DeepSeek",
  xai: "xAI Grok",
  mistral: "Mistral",
  perplexity: "Perplexity",
  cloudflare: "Cloudflare Workers AI",
  nvidia: "NVIDIA NIM",
  nararouter: "NaraRouter",
  ollama: "Ollama",
};

const PROVIDER_ORDER: SupportedProvider[] = [
  "openrouter",
  "openai",
  "anthropic",
  "gemini",
  "groq",
  "together",
  "fireworks",
  "cerebras",
  "deepseek",
  "xai",
  "mistral",
  "perplexity",
  "cloudflare",
  "nvidia",
  "nararouter",
  "ollama",
];

function getModelDisplayName(model: SupportedChatModel): string {
  const prefix = `${model.provider}:`;
  if (model.id.startsWith(prefix)) return model.id.slice(prefix.length);
  if (model.provider === "openrouter") return model.id;
  return model.id;
}

function buildRows(modelIds: SupportedChatModelId[]): ModelRow[] {
  const allowed = new Set<string>(modelIds);
  const rows: ModelRow[] = [];

  for (const provider of PROVIDER_ORDER) {
    const providerModels = SUPPORTED_CHAT_MODELS
      .filter((model) => model.provider === provider && allowed.has(model.id))
      .sort((a, b) => getModelDisplayName(a).localeCompare(getModelDisplayName(b)));

    if (providerModels.length === 0) continue;

    rows.push({
      type: "provider",
      provider,
      label: PROVIDER_LABELS[provider],
      count: providerModels.length,
    });

    for (const model of providerModels) {
      rows.push({
        type: "model",
        model,
        name: getModelDisplayName(model),
        providerLabel: PROVIDER_LABELS[provider],
      });
    }
  }

  return rows;
}

export const ModelsDialogContent = ({
  models,
  onSelectModel,
}: ModelsDialogContentProps) => {
  const dialog = useDialog();
  const { colors } = useTheme();
  const { model: currentModel } = usePromptConfig();
  const rows = buildRows(models);

  const handleSelect = useCallback(
    (row: ModelRow) => {
      if (row.type !== "model") return;
      onSelectModel(row.model.id);
      dialog.close();
    },
    [dialog, onSelectModel],
  );

  return (
    <DialogSearchList
      items={rows}
      onSelect={handleSelect}
      filterFn={(row, query) => {
        const needle = query.toLowerCase();
        if (row.type === "provider") {
          return row.label.toLowerCase().includes(needle);
        }
        return row.name.toLowerCase().includes(needle)
          || row.model.id.toLowerCase().includes(needle)
          || row.providerLabel.toLowerCase().includes(needle);
      }}
      renderItem={(row, isSelected) => {
        if (row.type === "provider") {
          return (
            <box flexDirection="row" gap={1}>
              <text
                selectable={false}
                attributes={TextAttributes.BOLD}
                fg={isSelected ? "black" : colors.primary}
              >
                {row.label}
              </text>
              <text
                selectable={false}
                attributes={TextAttributes.DIM}
                fg={isSelected ? "black" : colors.dimSeparator}
              >
                {row.count} models
              </text>
            </box>
          );
        }

        const isCurrent = row.model.id === currentModel;
        const hasBilling = row.model.pricing.inputUsdPerMillionTokens > 0
          || row.model.pricing.outputUsdPerMillionTokens > 0;

        return (
          <box flexDirection="row" gap={1}>
            <text selectable={false} fg={isSelected ? "black" : "white"}>
              {"  "}
              {isCurrent ? "* " : "  "}
              {row.name}
            </text>
            <text
              selectable={false}
              attributes={TextAttributes.DIM}
              fg={isSelected ? "black" : colors.dimSeparator}
            >
              {hasBilling ? "billed" : "free"}
            </text>
          </box>
        );
      }}
      getKey={(row) => row.type === "provider" ? `provider-${row.provider}` : row.model.id}
      placeholder="Search providers or models"
      emptyText="No matching models"
    />
  );
};
