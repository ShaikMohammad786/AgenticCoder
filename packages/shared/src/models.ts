// ── Model definitions ──

export type ModelPricing = {
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
};

export type SupportedProvider = "openrouter" | "ollama";

type SupportedChatModelDefinition = {
  id: string;
  provider: SupportedProvider;
  pricing: ModelPricing;
  supportsVision?: boolean;
};

export const SUPPORTED_CHAT_MODELS = [
  {
    id: "qwen/qwen3-coder:free",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
  },
  {
    id: "nvidia/nemotron-3-ultra-550b-a55b:free",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
  },
  {
    id: "nvidia/nemotron-3-super-120b-a12b:free",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
  },
  {
    id: "google/gemma-4-31b-it:free",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
  },
  {
    id: "google/gemma-4-26b-a4b-it:free",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
  },
  {
    id: "qwen/qwen3-next-80b-a3b-instruct:free",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
  },
  {
    id: "nvidia/nemotron-3-nano-30b-a3b:free",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
  },
  {
    id: "nex-agi/nex-n2-pro:free",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
  },
  {
    id: "poolside/laguna-m.1:free",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
  },
  {
    id: "poolside/laguna-xs.2:free",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
  },
  {
    id: "openai/gpt-oss-120b:free",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
  },
  {
    id: "openai/gpt-oss-20b:free",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
  },
  {
    id: "meta-llama/llama-3.3-70b-instruct:free",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
  },
  {
    id: "nousresearch/hermes-3-llama-3.1-405b:free",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
  },
  {
    id: "nvidia/nemotron-nano-9b-v2:free",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
  },
] as const satisfies readonly SupportedChatModelDefinition[];

export type SupportedChatModel = (typeof SUPPORTED_CHAT_MODELS)[number];
export type SupportedChatModelId = SupportedChatModel["id"];

export function findSupportedChatModel(modelId: string) {
  return SUPPORTED_CHAT_MODELS.find((model) => model.id === modelId);
}

export const DEFAULT_CHAT_MODEL_ID: SupportedChatModelId = "qwen/qwen3-coder:free";

/** Check if a provider is local (no cloud API needed) */
export function isLocalProvider(provider: SupportedProvider): boolean {
  return provider === "ollama";
}

/** Check if a model ID refers to an Ollama model */
export function isOllamaModel(modelId: string): boolean {
  return modelId.startsWith("ollama:");
}

/** Check if a model supports vision/image input */
export function modelSupportsVision(modelId: string): boolean {
  const model = findSupportedChatModel(modelId) as (SupportedChatModelDefinition | undefined);
  return (model as any)?.supportsVision === true;
}