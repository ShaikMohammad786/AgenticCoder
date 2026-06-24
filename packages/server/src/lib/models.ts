import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createOllama } from "ollama-ai-provider";
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

const ollama = createOllama({
  baseURL: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/api",
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
      model: ollama.chat(ollamaModelName) as unknown as LanguageModel,
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