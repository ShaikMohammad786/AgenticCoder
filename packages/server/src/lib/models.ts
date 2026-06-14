import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  findSupportedChatModel,
  type SupportedChatModelId,
  type SupportedProvider,
} from "@agenticcoder/shared";
import type { LanguageModel } from "ai";

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

export type ResolvedModel = {
  model: LanguageModel;
  provider: SupportedProvider;
  modelId: SupportedChatModelId;
};

export function isSupportedChatModel(modelId: string): modelId is SupportedChatModelId {
  return findSupportedChatModel(modelId) != null;
};

export function resolveChatModel(modelId: string): ResolvedModel {
  const model = findSupportedChatModel(modelId);
  if (!model) {
    throw new Error(`Unsupported model: ${modelId}`);
  }

  return {
    model: openrouter.chat(model.id),
    provider: "openrouter",
    modelId: model.id,
  };
};