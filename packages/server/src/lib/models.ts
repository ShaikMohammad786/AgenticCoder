import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createOpenAI, type OpenAIProvider } from "@ai-sdk/openai";
import {
  findSupportedChatModel,
  getModelApiId,
  isOllamaModel,
  type SupportedProvider,
} from "@agenticcoder/shared";
import type { LanguageModel } from "ai";

type RemoteProvider = Exclude<SupportedProvider, "openrouter" | "ollama">;
type ProviderPrefix = Exclude<SupportedProvider, "ollama">;

const DIRECT_PROVIDER_PREFIXES = new Set<ProviderPrefix>([
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
]);

const OPENAI_COMPATIBLE_PROVIDERS: Record<Exclude<RemoteProvider, "anthropic">, {
  baseURL?: string;
  envKeys: string[];
}> = {
  openai: {
    envKeys: ["OPENAI_API_KEY"],
  },
  gemini: {
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    envKeys: ["GEMINI_API_KEY", "GOOGLE_AI_STUDIO_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
  },
  groq: {
    baseURL: "https://api.groq.com/openai/v1",
    envKeys: ["GROQ_API_KEY"],
  },
  together: {
    baseURL: "https://api.together.xyz/v1",
    envKeys: ["TOGETHER_API_KEY"],
  },
  fireworks: {
    baseURL: "https://api.fireworks.ai/inference/v1",
    envKeys: ["FIREWORKS_API_KEY"],
  },
  cerebras: {
    baseURL: "https://api.cerebras.ai/v1",
    envKeys: ["CEREBRAS_API_KEY"],
  },
  deepseek: {
    baseURL: "https://api.deepseek.com",
    envKeys: ["DEEPSEEK_API_KEY"],
  },
  xai: {
    baseURL: "https://api.x.ai/v1",
    envKeys: ["XAI_API_KEY"],
  },
  mistral: {
    baseURL: "https://api.mistral.ai/v1",
    envKeys: ["MISTRAL_API_KEY"],
  },
  perplexity: {
    baseURL: "https://api.perplexity.ai",
    envKeys: ["PERPLEXITY_API_KEY"],
  },
};

const openrouter = createOpenRouter({
  apiKey: getOptionalEnv("OPENROUTER_API_KEY"),
});

const providerCache = new Map<string, OpenAIProvider | ReturnType<typeof createAnthropic>>();

function getOptionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function getRequiredEnv(names: string[], provider: string): string {
  for (const name of names) {
    const value = getOptionalEnv(name);
    if (value) return value;
  }

  throw new Error(`Missing API key for ${provider}. Set one of: ${names.join(", ")}`);
}

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

function splitProviderModelId(modelId: string): { provider: ProviderPrefix; apiModelId: string } | null {
  const separator = modelId.indexOf(":");
  if (separator <= 0) return null;
  const provider = modelId.slice(0, separator) as ProviderPrefix;
  const apiModelId = modelId.slice(separator + 1);
  if (!DIRECT_PROVIDER_PREFIXES.has(provider) || !apiModelId) return null;
  return { provider, apiModelId };
}

function getOpenAICompatibleProvider(provider: Exclude<RemoteProvider, "anthropic">): OpenAIProvider {
  const cached = providerCache.get(provider);
  if (cached) return cached as OpenAIProvider;

  const config = OPENAI_COMPATIBLE_PROVIDERS[provider];
  const instance = createOpenAI({
    name: provider,
    apiKey: getRequiredEnv(config.envKeys, provider),
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
  });
  providerCache.set(provider, instance);
  return instance;
}

function getAnthropicProvider() {
  const cached = providerCache.get("anthropic");
  if (cached) return cached as ReturnType<typeof createAnthropic>;

  const instance = createAnthropic({
    apiKey: getRequiredEnv(["ANTHROPIC_API_KEY"], "anthropic"),
  });
  providerCache.set("anthropic", instance);
  return instance;
}

export type ResolvedModel = {
  model: LanguageModel;
  provider: SupportedProvider;
  modelId: string;
  isLocal: boolean;
};

export function isSupportedChatModel(modelId: string): boolean {
  return findSupportedChatModel(modelId) != null || isOllamaModel(modelId) || splitProviderModelId(modelId) != null;
}

export function resolveChatModel(modelId: string): ResolvedModel {
  if (isOllamaModel(modelId)) {
    const ollamaModelName = modelId.replace(/^ollama:/, "");
    return {
      model: ollama.chat(ollamaModelName),
      provider: "ollama",
      modelId,
      isLocal: true,
    };
  }

  const catalogModel = findSupportedChatModel(modelId);
  if (catalogModel?.provider === "openrouter") {
    return {
      model: openrouter.chat(catalogModel.id),
      provider: "openrouter",
      modelId: catalogModel.id,
      isLocal: false,
    };
  }

  const directModel = catalogModel
    ? { provider: catalogModel.provider as RemoteProvider, apiModelId: getModelApiId(catalogModel) }
    : splitProviderModelId(modelId);

  if (!directModel) {
    throw new Error(`Unsupported model: ${modelId}`);
  }

  if (directModel.provider === "openrouter") {
    return {
      model: openrouter.chat(directModel.apiModelId),
      provider: "openrouter",
      modelId,
      isLocal: false,
    };
  }

  if (directModel.provider === "anthropic") {
    return {
      model: getAnthropicProvider()(directModel.apiModelId),
      provider: "anthropic",
      modelId,
      isLocal: false,
    };
  }

  return {
    model: getOpenAICompatibleProvider(directModel.provider)(directModel.apiModelId),
    provider: directModel.provider,
    modelId,
    isLocal: false,
  };
}
