// Model definitions

export type ModelPricing = {
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
};

export type SupportedProvider =
  | "openrouter"
  | "openai"
  | "anthropic"
  | "gemini"
  | "groq"
  | "together"
  | "fireworks"
  | "cerebras"
  | "deepseek"
  | "xai"
  | "mistral"
  | "perplexity"
  | "cloudflare"
  | "nvidia"
  | "nararouter"
  | "ollama";

type SupportedChatModelDefinition = {
  id: string;
  provider: SupportedProvider;
  pricing: ModelPricing;
  supportsVision?: boolean;
  apiModelId?: string;
  envKeys?: readonly string[];
};

const PRICING = {
  openai: {
    gpt5: { inputUsdPerMillionTokens: 1.25, outputUsdPerMillionTokens: 10 },
    gpt5Mini: { inputUsdPerMillionTokens: 0.25, outputUsdPerMillionTokens: 2 },
    gpt5Nano: { inputUsdPerMillionTokens: 0.05, outputUsdPerMillionTokens: 0.4 },
    gpt41: { inputUsdPerMillionTokens: 2, outputUsdPerMillionTokens: 8 },
    gpt41Mini: { inputUsdPerMillionTokens: 0.4, outputUsdPerMillionTokens: 1.6 },
    gpt4o: { inputUsdPerMillionTokens: 2.5, outputUsdPerMillionTokens: 10 },
    gpt4oMini: { inputUsdPerMillionTokens: 0.15, outputUsdPerMillionTokens: 0.6 },
    o1: { inputUsdPerMillionTokens: 15, outputUsdPerMillionTokens: 60 },
    o3: { inputUsdPerMillionTokens: 2, outputUsdPerMillionTokens: 8 },
    o4Mini: { inputUsdPerMillionTokens: 1.1, outputUsdPerMillionTokens: 4.4 },
  },
  anthropic: {
    opus: { inputUsdPerMillionTokens: 15, outputUsdPerMillionTokens: 75 },
    sonnet: { inputUsdPerMillionTokens: 3, outputUsdPerMillionTokens: 15 },
    haiku: { inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 5 },
  },
  gemini: {
    pro: { inputUsdPerMillionTokens: 1.25, outputUsdPerMillionTokens: 10 },
    flash: { inputUsdPerMillionTokens: 0.3, outputUsdPerMillionTokens: 2.5 },
    flashLite: { inputUsdPerMillionTokens: 0.1, outputUsdPerMillionTokens: 0.4 },
  },
  deepseek: {
    chat: { inputUsdPerMillionTokens: 0.27, outputUsdPerMillionTokens: 1.1 },
    reasoner: { inputUsdPerMillionTokens: 0.55, outputUsdPerMillionTokens: 2.19 },
  },
  mistral: {
    large: { inputUsdPerMillionTokens: 2, outputUsdPerMillionTokens: 6 },
    medium: { inputUsdPerMillionTokens: 0.4, outputUsdPerMillionTokens: 2 },
    small: { inputUsdPerMillionTokens: 0.1, outputUsdPerMillionTokens: 0.3 },
    codestral: { inputUsdPerMillionTokens: 0.3, outputUsdPerMillionTokens: 0.9 },
  },
  nararouter: {
    mimoFree: { inputUsdPerMillionTokens: 0.03, outputUsdPerMillionTokens: 0.08 },
    mimoProFree: { inputUsdPerMillionTokens: 0.13, outputUsdPerMillionTokens: 0.26 },
    mistralLarge: { inputUsdPerMillionTokens: 0.05, outputUsdPerMillionTokens: 0.15 },
    mistralMedium35: { inputUsdPerMillionTokens: 0.15, outputUsdPerMillionTokens: 0.74 },
  },
} satisfies Record<string, Record<string, ModelPricing>>;

export const DEFAULT_PROVIDER_PRICING: Record<Exclude<SupportedProvider, "ollama">, ModelPricing> = {
  openrouter: { inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 3 },
  openai: { inputUsdPerMillionTokens: 1.25, outputUsdPerMillionTokens: 10 },
  anthropic: { inputUsdPerMillionTokens: 3, outputUsdPerMillionTokens: 15 },
  gemini: { inputUsdPerMillionTokens: 1.25, outputUsdPerMillionTokens: 10 },
  groq: { inputUsdPerMillionTokens: 0.5, outputUsdPerMillionTokens: 0.8 },
  together: { inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 3 },
  fireworks: { inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 3 },
  cerebras: { inputUsdPerMillionTokens: 0.6, outputUsdPerMillionTokens: 1.2 },
  deepseek: { inputUsdPerMillionTokens: 0.3, outputUsdPerMillionTokens: 1.2 },
  xai: { inputUsdPerMillionTokens: 3, outputUsdPerMillionTokens: 15 },
  mistral: { inputUsdPerMillionTokens: 2, outputUsdPerMillionTokens: 6 },
  perplexity: { inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 3 },
  cloudflare: { inputUsdPerMillionTokens: 0.2, outputUsdPerMillionTokens: 0.8 },
  nvidia: { inputUsdPerMillionTokens: 0.5, outputUsdPerMillionTokens: 1.5 },
  nararouter: { inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 3 },
};

function byok(
  provider: Exclude<SupportedProvider, "openrouter" | "ollama">,
  model: string,
  options: {
    apiModelId?: string;
    supportsVision?: boolean;
    envKeys?: readonly string[];
    pricing?: ModelPricing;
  } = {},
): SupportedChatModelDefinition {
  return {
    id: `${provider}:${model}`,
    provider,
    apiModelId: options.apiModelId ?? model,
    pricing: options.pricing ?? DEFAULT_PROVIDER_PRICING[provider],
    supportsVision: options.supportsVision,
    envKeys: options.envKeys,
  };
}

function openrouter(model: string, supportsVision = false, pricing?: ModelPricing): SupportedChatModelDefinition {
  return {
    id: model,
    provider: "openrouter",
    pricing: pricing ?? DEFAULT_PROVIDER_PRICING.openrouter,
    supportsVision,
  };
}

export const SUPPORTED_CHAT_MODELS = [
  // OpenRouter free/community catalog entries. They still use fallback billing prices.
  openrouter("qwen/qwen3-coder:free"),
  openrouter("openai/gpt-oss-120b:free"),
  openrouter("openai/gpt-oss-20b:free"),
  openrouter("meta-llama/llama-3.3-70b-instruct:free"),
  openrouter("nousresearch/hermes-3-llama-3.1-405b:free"),
  openrouter("deepseek/deepseek-r1-0528:free"),
  openrouter("deepseek/deepseek-chat-v3-0324:free"),
  openrouter("mistralai/devstral-small:free"),
  openrouter("moonshotai/kimi-dev-72b:free"),
  openrouter("qwen/qwen3-235b-a22b:free"),
  openrouter("qwen/qwen3-32b:free"),
  openrouter("meta-llama/llama-4-maverick:free"),
  openrouter("meta-llama/llama-4-scout:free"),
  openrouter("nvidia/nemotron-3-ultra-550b-a55b:free"),
  openrouter("nvidia/nemotron-3-super-120b-a12b:free"),
  openrouter("nvidia/nemotron-3-nano-30b-a3b:free"),
  openrouter("nvidia/nemotron-nano-9b-v2:free"),
  openrouter("google/gemma-4-31b-it:free"),
  openrouter("google/gemma-4-26b-a4b-it:free"),
  openrouter("qwen/qwen3-next-80b-a3b-instruct:free"),
  openrouter("nex-agi/nex-n2-pro:free"),
  openrouter("poolside/laguna-m.1:free"),
  openrouter("poolside/laguna-xs.2:free"),
  openrouter("openai/gpt-5", true),
  openrouter("openai/gpt-5-mini", true),
  openrouter("openai/gpt-4.1", true),
  openrouter("anthropic/claude-sonnet-4.5", true),
  openrouter("anthropic/claude-opus-4.1", true),
  openrouter("anthropic/claude-3.7-sonnet", true),
  openrouter("google/gemini-2.5-pro", true),
  openrouter("google/gemini-2.5-flash", true),
  openrouter("google/gemini-2.0-flash-001", true),
  openrouter("deepseek/deepseek-chat-v3-0324"),
  openrouter("deepseek/deepseek-r1"),
  openrouter("qwen/qwen-2.5-coder-32b-instruct"),
  openrouter("qwen/qwen3-coder"),
  openrouter("x-ai/grok-4", true),
  openrouter("x-ai/grok-3", true),
  openrouter("mistralai/mistral-large"),
  openrouter("mistralai/codestral-2501"),
  openrouter("moonshotai/kimi-k2"),
  openrouter("z-ai/glm-4.5"),

  // OpenAI direct API.
  byok("openai", "gpt-5", { supportsVision: true, envKeys: ["OPENAI_API_KEY"], pricing: PRICING.openai.gpt5 }),
  byok("openai", "gpt-5-mini", { supportsVision: true, envKeys: ["OPENAI_API_KEY"], pricing: PRICING.openai.gpt5Mini }),
  byok("openai", "gpt-5-nano", { supportsVision: true, envKeys: ["OPENAI_API_KEY"], pricing: PRICING.openai.gpt5Nano }),
  byok("openai", "gpt-4.1", { supportsVision: true, envKeys: ["OPENAI_API_KEY"], pricing: PRICING.openai.gpt41 }),
  byok("openai", "gpt-4.1-mini", { supportsVision: true, envKeys: ["OPENAI_API_KEY"], pricing: PRICING.openai.gpt41Mini }),
  byok("openai", "gpt-4o", { supportsVision: true, envKeys: ["OPENAI_API_KEY"], pricing: PRICING.openai.gpt4o }),
  byok("openai", "gpt-4o-mini", { supportsVision: true, envKeys: ["OPENAI_API_KEY"], pricing: PRICING.openai.gpt4oMini }),
  byok("openai", "chatgpt-4o-latest", { supportsVision: true, envKeys: ["OPENAI_API_KEY"], pricing: PRICING.openai.gpt4o }),
  byok("openai", "o3", { supportsVision: true, envKeys: ["OPENAI_API_KEY"], pricing: PRICING.openai.o3 }),
  byok("openai", "o3-mini", { supportsVision: true, envKeys: ["OPENAI_API_KEY"], pricing: PRICING.openai.o4Mini }),
  byok("openai", "o4-mini", { supportsVision: true, envKeys: ["OPENAI_API_KEY"], pricing: PRICING.openai.o4Mini }),
  byok("openai", "o1", { supportsVision: true, envKeys: ["OPENAI_API_KEY"], pricing: PRICING.openai.o1 }),
  byok("openai", "o1-mini", { envKeys: ["OPENAI_API_KEY"], pricing: PRICING.openai.o4Mini }),

  // Anthropic direct API.
  byok("anthropic", "claude-opus-4-1-20250805", { supportsVision: true, envKeys: ["ANTHROPIC_API_KEY"], pricing: PRICING.anthropic.opus }),
  byok("anthropic", "claude-opus-4-20250514", { supportsVision: true, envKeys: ["ANTHROPIC_API_KEY"], pricing: PRICING.anthropic.opus }),
  byok("anthropic", "claude-sonnet-4-5-20250929", { supportsVision: true, envKeys: ["ANTHROPIC_API_KEY"], pricing: PRICING.anthropic.sonnet }),
  byok("anthropic", "claude-sonnet-4-5", { supportsVision: true, envKeys: ["ANTHROPIC_API_KEY"], pricing: PRICING.anthropic.sonnet }),
  byok("anthropic", "claude-sonnet-4-20250514", { supportsVision: true, envKeys: ["ANTHROPIC_API_KEY"], pricing: PRICING.anthropic.sonnet }),
  byok("anthropic", "claude-haiku-4-5", { supportsVision: true, envKeys: ["ANTHROPIC_API_KEY"], pricing: PRICING.anthropic.haiku }),
  byok("anthropic", "claude-3-7-sonnet-20250219", { supportsVision: true, envKeys: ["ANTHROPIC_API_KEY"], pricing: PRICING.anthropic.sonnet }),
  byok("anthropic", "claude-3-5-haiku-20241022", { supportsVision: true, envKeys: ["ANTHROPIC_API_KEY"], pricing: PRICING.anthropic.haiku }),

  // Google Gemini API / AI Studio through the OpenAI-compatible endpoint.
  byok("gemini", "gemini-2.5-pro", {
    supportsVision: true,
    envKeys: ["GEMINI_API_KEY", "GOOGLE_AI_STUDIO_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
    pricing: PRICING.gemini.pro,
  }),
  byok("gemini", "gemini-2.5-flash", {
    supportsVision: true,
    envKeys: ["GEMINI_API_KEY", "GOOGLE_AI_STUDIO_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
    pricing: PRICING.gemini.flash,
  }),
  byok("gemini", "gemini-2.5-flash-lite", {
    supportsVision: true,
    envKeys: ["GEMINI_API_KEY", "GOOGLE_AI_STUDIO_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
    pricing: PRICING.gemini.flashLite,
  }),
  byok("gemini", "gemini-2.0-flash", {
    supportsVision: true,
    envKeys: ["GEMINI_API_KEY", "GOOGLE_AI_STUDIO_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
    pricing: PRICING.gemini.flash,
  }),
  byok("gemini", "gemini-2.0-flash-lite", {
    supportsVision: true,
    envKeys: ["GEMINI_API_KEY", "GOOGLE_AI_STUDIO_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
    pricing: PRICING.gemini.flashLite,
  }),
  byok("gemini", "gemini-1.5-pro", {
    supportsVision: true,
    envKeys: ["GEMINI_API_KEY", "GOOGLE_AI_STUDIO_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
    pricing: PRICING.gemini.pro,
  }),
  byok("gemini", "gemini-1.5-flash", {
    supportsVision: true,
    envKeys: ["GEMINI_API_KEY", "GOOGLE_AI_STUDIO_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
    pricing: PRICING.gemini.flash,
  }),

  // Fast/free-tier friendly OpenAI-compatible providers.
  byok("groq", "openai/gpt-oss-120b", { envKeys: ["GROQ_API_KEY"] }),
  byok("groq", "openai/gpt-oss-20b", { envKeys: ["GROQ_API_KEY"] }),
  byok("groq", "llama-3.3-70b-versatile", { envKeys: ["GROQ_API_KEY"] }),
  byok("groq", "llama-3.1-8b-instant", { envKeys: ["GROQ_API_KEY"] }),
  byok("groq", "meta-llama/llama-4-scout-17b-16e-instruct", { envKeys: ["GROQ_API_KEY"] }),
  byok("groq", "meta-llama/llama-4-maverick-17b-128e-instruct", { envKeys: ["GROQ_API_KEY"] }),
  byok("groq", "qwen/qwen3-32b", { envKeys: ["GROQ_API_KEY"] }),
  byok("groq", "deepseek-r1-distill-llama-70b", { envKeys: ["GROQ_API_KEY"] }),
  byok("groq", "moonshotai/kimi-k2-instruct", { envKeys: ["GROQ_API_KEY"] }),
  byok("groq", "gemma2-9b-it", { envKeys: ["GROQ_API_KEY"] }),
  byok("groq", "mistral-saba-24b", { envKeys: ["GROQ_API_KEY"] }),
  byok("groq", "compound-beta", { envKeys: ["GROQ_API_KEY"] }),
  byok("groq", "compound-beta-mini", { envKeys: ["GROQ_API_KEY"] }),

  byok("cerebras", "qwen-3-coder-480b", { envKeys: ["CEREBRAS_API_KEY"] }),
  byok("cerebras", "qwen-3-235b-a22b-instruct-2507", { envKeys: ["CEREBRAS_API_KEY"] }),
  byok("cerebras", "qwen-3-32b", { envKeys: ["CEREBRAS_API_KEY"] }),
  byok("cerebras", "llama-4-maverick-17b-128e-instruct", { envKeys: ["CEREBRAS_API_KEY"] }),
  byok("cerebras", "llama-4-scout-17b-16e-instruct", { envKeys: ["CEREBRAS_API_KEY"] }),
  byok("cerebras", "llama3.1-8b", { envKeys: ["CEREBRAS_API_KEY"] }),

  byok("together", "meta-llama/Llama-3.3-70B-Instruct-Turbo-Free", { envKeys: ["TOGETHER_API_KEY"] }),
  byok("together", "meta-llama/Llama-3.3-70B-Instruct-Turbo", { envKeys: ["TOGETHER_API_KEY"] }),
  byok("together", "meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo", { envKeys: ["TOGETHER_API_KEY"] }),
  byok("together", "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo", { envKeys: ["TOGETHER_API_KEY"] }),
  byok("together", "Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8", { envKeys: ["TOGETHER_API_KEY"] }),
  byok("together", "Qwen/Qwen2.5-72B-Instruct-Turbo", { envKeys: ["TOGETHER_API_KEY"] }),
  byok("together", "Qwen/Qwen2.5-Coder-32B-Instruct", { envKeys: ["TOGETHER_API_KEY"] }),
  byok("together", "deepseek-ai/DeepSeek-R1-Distill-Llama-70B-free", { envKeys: ["TOGETHER_API_KEY"] }),
  byok("together", "deepseek-ai/DeepSeek-V3", { envKeys: ["TOGETHER_API_KEY"] }),
  byok("together", "mistralai/Mixtral-8x7B-Instruct-v0.1", { envKeys: ["TOGETHER_API_KEY"] }),
  byok("together", "mistralai/Mistral-7B-Instruct-v0.3", { envKeys: ["TOGETHER_API_KEY"] }),
  byok("together", "google/gemma-2-27b-it", { envKeys: ["TOGETHER_API_KEY"] }),

  byok("fireworks", "accounts/fireworks/models/qwen3-coder-480b-a35b-instruct", { envKeys: ["FIREWORKS_API_KEY"] }),
  byok("fireworks", "accounts/fireworks/models/qwen2p5-coder-32b-instruct", { envKeys: ["FIREWORKS_API_KEY"] }),
  byok("fireworks", "accounts/fireworks/models/llama-v3p3-70b-instruct", { envKeys: ["FIREWORKS_API_KEY"] }),
  byok("fireworks", "accounts/fireworks/models/llama4-maverick-instruct-basic", { envKeys: ["FIREWORKS_API_KEY"] }),
  byok("fireworks", "accounts/fireworks/models/llama4-scout-instruct-basic", { envKeys: ["FIREWORKS_API_KEY"] }),
  byok("fireworks", "accounts/fireworks/models/deepseek-v3", { envKeys: ["FIREWORKS_API_KEY"] }),
  byok("fireworks", "accounts/fireworks/models/deepseek-r1", { envKeys: ["FIREWORKS_API_KEY"] }),
  byok("fireworks", "accounts/fireworks/models/mixtral-8x7b-instruct", { envKeys: ["FIREWORKS_API_KEY"] }),
  byok("fireworks", "accounts/fireworks/models/mistral-7b-instruct-4k", { envKeys: ["FIREWORKS_API_KEY"] }),

  byok("cloudflare", "@cf/meta/llama-3.3-70b-instruct-fp8-fast", { envKeys: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_AI_API_TOKEN"] }),
  byok("cloudflare", "@cf/meta/llama-3.1-8b-instruct", { envKeys: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_AI_API_TOKEN"] }),
  byok("cloudflare", "@cf/meta/llama-3.2-3b-instruct", { envKeys: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_AI_API_TOKEN"] }),
  byok("cloudflare", "@cf/meta/llama-3.2-1b-instruct", { envKeys: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_AI_API_TOKEN"] }),
  byok("cloudflare", "@cf/qwen/qwen2.5-coder-32b-instruct", { envKeys: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_AI_API_TOKEN"] }),
  byok("cloudflare", "@cf/qwen/qwen1.5-14b-chat-awq", { envKeys: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_AI_API_TOKEN"] }),
  byok("cloudflare", "@cf/mistral/mistral-7b-instruct-v0.2-lora", { envKeys: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_AI_API_TOKEN"] }),
  byok("cloudflare", "@cf/google/gemma-7b-it-lora", { envKeys: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_AI_API_TOKEN"] }),

  byok("nvidia", "meta/llama-3.3-70b-instruct", { envKeys: ["NVIDIA_API_KEY", "NVIDIA_NIM_API_KEY"] }),
  byok("nvidia", "meta/llama-3.1-405b-instruct", { envKeys: ["NVIDIA_API_KEY", "NVIDIA_NIM_API_KEY"] }),
  byok("nvidia", "meta/llama-3.1-70b-instruct", { envKeys: ["NVIDIA_API_KEY", "NVIDIA_NIM_API_KEY"] }),
  byok("nvidia", "meta/llama-3.1-8b-instruct", { envKeys: ["NVIDIA_API_KEY", "NVIDIA_NIM_API_KEY"] }),
  byok("nvidia", "nvidia/llama-3.1-nemotron-70b-instruct", { envKeys: ["NVIDIA_API_KEY", "NVIDIA_NIM_API_KEY"] }),
  byok("nvidia", "nvidia/llama-3.1-nemotron-ultra-253b-v1", { envKeys: ["NVIDIA_API_KEY", "NVIDIA_NIM_API_KEY"] }),
  byok("nvidia", "nvidia/nemotron-4-340b-instruct", { envKeys: ["NVIDIA_API_KEY", "NVIDIA_NIM_API_KEY"] }),
  byok("nvidia", "mistralai/mixtral-8x7b-instruct-v0.1", { envKeys: ["NVIDIA_API_KEY", "NVIDIA_NIM_API_KEY"] }),
  byok("nvidia", "qwen/qwen2.5-coder-32b-instruct", { envKeys: ["NVIDIA_API_KEY", "NVIDIA_NIM_API_KEY"] }),
  byok("nvidia", "deepseek-ai/deepseek-r1", { envKeys: ["NVIDIA_API_KEY", "NVIDIA_NIM_API_KEY"] }),

  byok("nararouter", "mimo-v2.5-free", { supportsVision: true, envKeys: ["NARAROUTER_API_KEY"], pricing: PRICING.nararouter.mimoFree }),
  byok("nararouter", "mimo-v2.5-pro-free", { envKeys: ["NARAROUTER_API_KEY"], pricing: PRICING.nararouter.mimoProFree }),
  byok("nararouter", "mistral-large", { envKeys: ["NARAROUTER_API_KEY"], pricing: PRICING.nararouter.mistralLarge }),
  byok("nararouter", "mistral-medium-3-5", { supportsVision: true, envKeys: ["NARAROUTER_API_KEY"], pricing: PRICING.nararouter.mistralMedium35 }),
  byok("nararouter", "openai/gpt-oss-120b", { envKeys: ["NARAROUTER_API_KEY"] }),
  byok("nararouter", "qwen/qwen3-coder", { envKeys: ["NARAROUTER_API_KEY"] }),
  byok("nararouter", "qwen/qwen3-32b", { envKeys: ["NARAROUTER_API_KEY"] }),
  byok("nararouter", "deepseek/deepseek-chat", { envKeys: ["NARAROUTER_API_KEY"] }),
  byok("nararouter", "deepseek/deepseek-r1", { envKeys: ["NARAROUTER_API_KEY"] }),
  byok("nararouter", "meta-llama/llama-3.3-70b-instruct", { envKeys: ["NARAROUTER_API_KEY"] }),
  byok("nararouter", "google/gemini-2.5-flash", { supportsVision: true, envKeys: ["NARAROUTER_API_KEY"] }),
  byok("nararouter", "anthropic/claude-sonnet-4.5", { supportsVision: true, envKeys: ["NARAROUTER_API_KEY"] }),

  // Other direct providers.
  byok("deepseek", "deepseek-chat", { envKeys: ["DEEPSEEK_API_KEY"], pricing: PRICING.deepseek.chat }),
  byok("deepseek", "deepseek-reasoner", { envKeys: ["DEEPSEEK_API_KEY"], pricing: PRICING.deepseek.reasoner }),

  byok("xai", "grok-4", { supportsVision: true, envKeys: ["XAI_API_KEY"] }),
  byok("xai", "grok-4-fast", { supportsVision: true, envKeys: ["XAI_API_KEY"] }),
  byok("xai", "grok-3", { supportsVision: true, envKeys: ["XAI_API_KEY"] }),
  byok("xai", "grok-3-mini", { envKeys: ["XAI_API_KEY"] }),

  byok("mistral", "mistral-large-latest", { envKeys: ["MISTRAL_API_KEY"], pricing: PRICING.mistral.large }),
  byok("mistral", "mistral-medium-latest", { envKeys: ["MISTRAL_API_KEY"], pricing: PRICING.mistral.medium }),
  byok("mistral", "mistral-small-latest", { envKeys: ["MISTRAL_API_KEY"], pricing: PRICING.mistral.small }),
  byok("mistral", "codestral-latest", { envKeys: ["MISTRAL_API_KEY"], pricing: PRICING.mistral.codestral }),
  byok("mistral", "open-mistral-nemo", { envKeys: ["MISTRAL_API_KEY"], pricing: PRICING.mistral.small }),
  byok("mistral", "devstral-small-latest", { envKeys: ["MISTRAL_API_KEY"], pricing: PRICING.mistral.codestral }),
  byok("mistral", "magistral-medium-latest", { envKeys: ["MISTRAL_API_KEY"], pricing: PRICING.mistral.medium }),
  byok("mistral", "magistral-small-latest", { envKeys: ["MISTRAL_API_KEY"], pricing: PRICING.mistral.small }),

  byok("perplexity", "sonar", { envKeys: ["PERPLEXITY_API_KEY"] }),
  byok("perplexity", "sonar-pro", { envKeys: ["PERPLEXITY_API_KEY"] }),
  byok("perplexity", "sonar-reasoning", { envKeys: ["PERPLEXITY_API_KEY"] }),
  byok("perplexity", "sonar-deep-research", { envKeys: ["PERPLEXITY_API_KEY"] }),
] as const satisfies readonly SupportedChatModelDefinition[];

export type SupportedChatModel = (typeof SUPPORTED_CHAT_MODELS)[number];
export type SupportedChatModelId = SupportedChatModel["id"];

export function findSupportedChatModel(modelId: string) {
  return SUPPORTED_CHAT_MODELS.find((model) => model.id === modelId);
}

export function getModelApiId(model: SupportedChatModelDefinition): string {
  return model.apiModelId ?? model.id;
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
  return model?.supportsVision === true;
}
