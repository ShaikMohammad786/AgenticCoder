import {
  DEFAULT_PROVIDER_PRICING,
  SUPPORTED_CHAT_MODELS,
  findSupportedChatModel,
  type SupportedProvider,
  type ModelPricing,
} from "@agenticcoder/shared";
import type { LanguageModelUsage } from "ai";

type CalculateCreditsForUsageParams = {
  provider: string;
  model: string;
  usage: LanguageModelUsage;
};

type BillableUsage = {
  credits: number;
};

type TokenCounts = {
  inputTokens: number;
  outputTokens: number;
};

export function isZeroPricedModel(model: string): boolean {
  const supportedModel = findSupportedChatModel(model);
  return supportedModel != null
    && supportedModel.pricing.inputUsdPerMillionTokens === 0
    && supportedModel.pricing.outputUsdPerMillionTokens === 0;
}

const TOKENS_PER_MILLION = 1_000_000;
// Agenticcoder charges in internal credits instead of exposing provider pricing.
// We currently peg 1 credit to $0.01 so credits stay easy to reason about
// like cents, while still being granular enough for small AI usage. Change
// this constant if product wants a finer unit like 0.001 or a coarser one.
const USD_PER_CREDIT = 0.001;

function getTokenCounts(usage: LanguageModelUsage): TokenCounts {
  const inputTokens = usage.inputTokens;
  const outputTokens = usage.outputTokens;

  if (
    inputTokens == null ||
    outputTokens == null ||
    !Number.isFinite(inputTokens) ||
    !Number.isFinite(outputTokens) ||
    !Number.isInteger(inputTokens) ||
    !Number.isInteger(outputTokens) ||
    inputTokens < 0 ||
    outputTokens < 0
  ) {
    throw new Error("Credit conversion requires input and output token counts");
  }

  return {
    inputTokens,
    outputTokens,
  };
};

function getModelPricing(provider: string, model: string): ModelPricing {
  const supportedModel = findSupportedChatModel(model);

  if (supportedModel && supportedModel.provider === provider) {
    return supportedModel.pricing;
  }

  const providerHasCatalogModels = SUPPORTED_CHAT_MODELS.some((supportedModel) => supportedModel.provider === provider);
  const providerDefaultPricing = DEFAULT_PROVIDER_PRICING[provider as Exclude<SupportedProvider, "ollama">];

  if (!providerHasCatalogModels && !providerDefaultPricing) {
      throw new Error(`Unsupported billing provider: ${provider}`);
  }

  if (providerDefaultPricing && model.startsWith(`${provider}:`)) {
    return providerDefaultPricing;
  }

  if (provider === "openrouter" && model.startsWith("openrouter:")) {
    return DEFAULT_PROVIDER_PRICING.openrouter;
  }

  throw new Error(`Unsupported billing model: ${model}`);
};

function estimateCostUsd({ inputTokens, outputTokens }: TokenCounts, pricing: ModelPricing) {
  return (
    (inputTokens * pricing.inputUsdPerMillionTokens +
      outputTokens * pricing.outputUsdPerMillionTokens) /
    TOKENS_PER_MILLION
  );
};

function convertUsdToCredits(estimatedCostUsd: number) {
  if (estimatedCostUsd <= 0) {
    return 0;
  }

  // If a request costs any non-zero amount, charge at least 1 credit, then
  // round up so partial credits always become a whole credit.
  return Math.max(1, Math.ceil(estimatedCostUsd / USD_PER_CREDIT));
};


export function calculateCreditsForUsage({
  provider,
  model,
  usage,
}: CalculateCreditsForUsageParams): BillableUsage {
  const tokenCounts = getTokenCounts(usage);
  const pricing = getModelPricing(provider, model);
  const estimatedCostUsd = estimateCostUsd(tokenCounts, pricing);
  const credits = convertUsdToCredits(estimatedCostUsd);

  return {
    credits,
  };
};
