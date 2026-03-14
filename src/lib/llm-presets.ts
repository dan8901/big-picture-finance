// Provider presets for LLM configuration

export type ProviderKey =
  | "openai" | "anthropic" | "nvidia" | "deepseek" | "openrouter"
  | "groq" | "together" | "fireworks" | "mistral" | "perplexity"
  | "google" | "cohere" | "azure" | "aws-bedrock" | "ollama"
  | "lmstudio" | "custom";

export interface ProviderPreset {
  label: string;
  baseUrl: string | null; // null = native SDK (Anthropic)
  models: string[];
}

export const PROVIDER_PRESETS: Record<ProviderKey, ProviderPreset> = {
  openai: {
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-4o", "gpt-4o-mini", "o4-mini", "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano"],
  },
  anthropic: {
    label: "Anthropic",
    baseUrl: null,
    models: ["claude-sonnet-4-20250514", "claude-opus-4-20250514", "claude-haiku-3-5-20241022"],
  },
  google: {
    label: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    models: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
  },
  deepseek: {
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    models: ["deepseek-chat", "deepseek-reasoner"],
  },
  groq: {
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "gemma2-9b-it", "mixtral-8x7b-32768"],
  },
  mistral: {
    label: "Mistral AI",
    baseUrl: "https://api.mistral.ai/v1",
    models: ["mistral-large-latest", "mistral-medium-latest", "mistral-small-latest", "codestral-latest"],
  },
  openrouter: {
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    models: ["anthropic/claude-sonnet-4", "openai/gpt-4o", "google/gemini-2.5-pro", "deepseek/deepseek-chat"],
  },
  together: {
    label: "Together AI",
    baseUrl: "https://api.together.xyz/v1",
    models: ["meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo", "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo", "Qwen/Qwen2.5-72B-Instruct-Turbo", "mistralai/Mixtral-8x7B-Instruct-v0.1"],
  },
  fireworks: {
    label: "Fireworks AI",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    models: ["accounts/fireworks/models/llama-v3p1-70b-instruct", "accounts/fireworks/models/qwen2p5-72b-instruct", "accounts/fireworks/models/mixtral-8x7b-instruct"],
  },
  perplexity: {
    label: "Perplexity",
    baseUrl: "https://api.perplexity.ai",
    models: ["sonar-pro", "sonar", "sonar-reasoning-pro", "sonar-reasoning"],
  },
  cohere: {
    label: "Cohere",
    baseUrl: "https://api.cohere.com/compatibility/v1",
    models: ["command-r-plus", "command-r", "command-a-03-2025"],
  },
  nvidia: {
    label: "NVIDIA NIM",
    baseUrl: "https://inference-api.nvidia.com/v1",
    models: ["aws/anthropic/bedrock-claude-opus-4-6", "meta/llama-3.1-70b-instruct", "mistralai/mixtral-8x7b-instruct-v0.1"],
  },
  azure: {
    label: "Azure OpenAI",
    baseUrl: "https://{resource}.openai.azure.com/openai/deployments/{deployment}/v1",
    models: ["gpt-4o", "gpt-4o-mini"],
  },
  "aws-bedrock": {
    label: "AWS Bedrock",
    baseUrl: "https://bedrock-runtime.{region}.amazonaws.com/model/{model-id}/v1",
    models: ["anthropic.claude-sonnet-4-20250514-v1:0", "anthropic.claude-haiku-3-5-20241022-v1:0"],
  },
  ollama: {
    label: "Ollama (local)",
    baseUrl: "http://localhost:11434/v1",
    models: ["llama3.1", "qwen2.5", "mistral", "gemma2", "phi3", "codellama"],
  },
  lmstudio: {
    label: "LM Studio (local)",
    baseUrl: "http://localhost:1234/v1",
    models: [],
  },
  custom: {
    label: "Custom (OpenAI-compatible)",
    baseUrl: "",
    models: [],
  },
};

// Cost per 1M tokens (USD) — [input, output]
const MODEL_PRICING: Record<string, [number, number]> = {
  // OpenAI
  "gpt-4o": [2.5, 10.0],
  "gpt-4o-mini": [0.15, 0.6],
  "o4-mini": [1.1, 4.4],
  "gpt-4.1": [2.0, 8.0],
  "gpt-4.1-mini": [0.4, 1.6],
  "gpt-4.1-nano": [0.1, 0.4],
  // Anthropic
  "claude-sonnet-4": [3.0, 15.0],
  "claude-opus-4": [15.0, 75.0],
  "claude-haiku-3-5": [0.8, 4.0],
  // DeepSeek
  "deepseek-chat": [0.27, 1.1],
  "deepseek-reasoner": [0.55, 2.19],
  // Mistral
  "mistral-large": [2.0, 6.0],
  "mistral-small": [0.1, 0.3],
  "codestral": [0.3, 0.9],
  // Google
  "gemini-2.5-pro": [1.25, 10.0],
  "gemini-2.5-flash": [0.15, 0.6],
  "gemini-2.0-flash": [0.1, 0.4],
  // Groq (hosted open-source — pricing varies)
  "llama-3.3-70b": [0.59, 0.79],
  "llama-3.1-8b": [0.05, 0.08],
  // Cohere
  "command-r-plus": [2.5, 10.0],
  "command-r": [0.15, 0.6],
  // Perplexity
  "sonar-pro": [3.0, 15.0],
  "sonar": [1.0, 1.0],
};

const DEFAULT_PRICING: [number, number] = [1.0, 3.0];

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  // Try exact match first, then partial match for model names with prefixes
  let pricing = MODEL_PRICING[model];
  if (!pricing) {
    const key = Object.keys(MODEL_PRICING).find((k) => model.includes(k));
    pricing = key ? MODEL_PRICING[key] : DEFAULT_PRICING;
  }
  return (inputTokens * pricing[0] + outputTokens * pricing[1]) / 1_000_000;
}
