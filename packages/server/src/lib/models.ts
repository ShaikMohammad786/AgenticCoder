import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createOpenAI } from "@ai-sdk/openai";
import {
  findSupportedChatModel,
  isOllamaModel,
  type SupportedChatModelId,
  type SupportedProvider,
} from "@agenticcoder/shared";
import type { LanguageModel } from "ai";

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

function getOllamaOpenAIBaseURL(): string {
  const raw = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  return raw
    .replace(/\/+$/, "")
    .replace(/\/api$/, "")
    .replace(/\/v1$/, "") + "/v1";
}

const ollama = createOpenAI({
  name: "ollama",
  baseURL: getOllamaOpenAIBaseURL(),
  apiKey: process.env.OLLAMA_API_KEY ?? "ollama",
});

export type ResolvedModel = {
  model: LanguageModel;
  provider: SupportedProvider;
  modelId: string;
  isLocal: boolean;
};

export function isSupportedChatModel(modelId: string): boolean {
  // Accept both registered models and ollama: prefixed models
  return findSupportedChatModel(modelId) != null || isOllamaModel(modelId);
};

export function resolveChatModel(modelId: string): ResolvedModel {
  // Ollama models: "ollama:codellama:7b" → resolve via Ollama provider
  if (isOllamaModel(modelId)) {
    const ollamaModelName = modelId.replace(/^ollama:/, "");
    return {
      model: ollama.chat(ollamaModelName),
      provider: "ollama",
      modelId,
      isLocal: true,
    };
  }

  // OpenRouter models
  const model = findSupportedChatModel(modelId);
  if (!model) {
    throw new Error(`Unsupported model: ${modelId}`);
  }

  return {
    model: openrouter.chat(model.id),
    provider: "openrouter",
    modelId: model.id,
    isLocal: false,
  };
};
