import OpenAI from "openai";
import type { ChatCompletion, ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/db";
import { llmConfig, llmUsageLogs } from "@/db/schema";
import { desc } from "drizzle-orm";
import { estimateCost } from "./llm-presets";

// ── Types ──

export interface LLMToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LLMCompletionResult {
  content: string | null;
  toolCalls: LLMToolCall[];
  finishReason: "stop" | "tool_calls" | "length" | "other";
  usage: LLMUsage;
}

export interface LLMToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: LLMToolCall[];
  tool_call_id?: string;
}

interface LLMCompleteParams {
  messages: LLMMessage[];
  tools?: LLMToolDefinition[];
  maxTokens?: number;
  feature?: "chat" | "categorize" | "trips";
}

export interface LLMClient {
  complete(params: LLMCompleteParams): Promise<LLMCompletionResult>;
}

// ── Config cache ──

interface CachedConfig {
  provider: string;
  apiKey: string;
  baseUrl: string | null;
  model: string;
  fetchedAt: number;
}

let configCache: CachedConfig | null = null;
const CONFIG_TTL_MS = 60_000;

async function getConfig(): Promise<CachedConfig | null> {
  if (configCache && Date.now() - configCache.fetchedAt < CONFIG_TTL_MS) {
    return configCache;
  }
  const rows = await db.select().from(llmConfig).orderBy(desc(llmConfig.id)).limit(1);
  if (rows.length === 0) return null;
  const row = rows[0];
  configCache = {
    provider: row.provider,
    apiKey: row.apiKey,
    baseUrl: row.baseUrl,
    model: row.model,
    fetchedAt: Date.now(),
  };
  return configCache;
}

export function clearConfigCache() {
  configCache = null;
}

// ── Log usage ──

async function logUsage(feature: string, model: string, usage: LLMUsage) {
  try {
    const cost = estimateCost(model, usage.inputTokens, usage.outputTokens);
    await db.insert(llmUsageLogs).values({
      feature: feature as "chat" | "categorize" | "trips",
      model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      estimatedCost: cost.toFixed(6),
    });
  } catch {
    // Non-critical — don't fail the request
  }
}

// ── OpenAI-compatible client ──

class OpenAILLMClient implements LLMClient {
  private client: OpenAI;
  private model: string;
  private feature: string;

  constructor(apiKey: string, baseUrl: string, model: string, feature?: string) {
    this.client = new OpenAI({ apiKey, baseURL: baseUrl });
    this.model = model;
    this.feature = feature ?? "chat";
  }

  async complete(params: LLMCompleteParams): Promise<LLMCompletionResult> {
    const feature = params.feature ?? this.feature;

    // Build OpenAI messages
    const messages = params.messages.map((m) => {
      if (m.role === "tool") {
        return {
          role: "tool" as const,
          tool_call_id: m.tool_call_id!,
          content: m.content,
        };
      }
      if (m.role === "assistant" && m.tool_calls && m.tool_calls.length > 0) {
        return {
          role: "assistant" as const,
          content: m.content ?? "",
          tool_calls: m.tool_calls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: { name: tc.name, arguments: tc.arguments },
          })),
        };
      }
      return {
        role: m.role as "system" | "user" | "assistant",
        content: m.content,
      };
    });

    const requestParams: ChatCompletionCreateParamsNonStreaming = {
      model: this.model,
      max_tokens: params.maxTokens ?? 4096,
      messages: messages as ChatCompletionCreateParamsNonStreaming["messages"],
    };
    if (params.tools && params.tools.length > 0) {
      requestParams.tools = params.tools as ChatCompletionCreateParamsNonStreaming["tools"];
    }

    const response: ChatCompletion = await this.client.chat.completions.create(requestParams);

    const choice = response.choices[0];
    const message = choice?.message;

    const toolCalls: LLMToolCall[] = (message?.tool_calls ?? [])
      .filter((tc) => tc.type === "function")
      .map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
      }));

    const finishReason =
      choice?.finish_reason === "stop" ? "stop"
        : choice?.finish_reason === "tool_calls" ? "tool_calls"
          : choice?.finish_reason === "length" ? "length"
            : "other";

    const usage: LLMUsage = {
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    };

    await logUsage(feature, this.model, usage);

    return {
      content: message?.content ?? null,
      toolCalls,
      finishReason,
      usage,
    };
  }
}

// ── Anthropic native client ──

class AnthropicLLMClient implements LLMClient {
  private client: Anthropic;
  private model: string;
  private feature: string;

  constructor(apiKey: string, model: string, feature?: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
    this.feature = feature ?? "chat";
  }

  async complete(params: LLMCompleteParams): Promise<LLMCompletionResult> {
    const feature = params.feature ?? this.feature;

    // Extract system messages
    const systemMessages = params.messages.filter((m) => m.role === "system");
    const systemText = systemMessages.map((m) => m.content).join("\n\n");

    // Convert non-system messages to Anthropic format
    const anthropicMessages: Anthropic.MessageParam[] = [];
    for (const m of params.messages) {
      if (m.role === "system") continue;

      if (m.role === "tool") {
        // Tool results become user messages with tool_result content blocks
        const lastMsg = anthropicMessages[anthropicMessages.length - 1];
        const toolResultBlock: Anthropic.ToolResultBlockParam = {
          type: "tool_result",
          tool_use_id: m.tool_call_id!,
          content: m.content,
        };
        // Consolidate consecutive tool results into one user message
        if (lastMsg && lastMsg.role === "user" && Array.isArray(lastMsg.content)) {
          (lastMsg.content as Anthropic.ContentBlockParam[]).push(toolResultBlock);
        } else {
          anthropicMessages.push({
            role: "user",
            content: [toolResultBlock],
          });
        }
        continue;
      }

      if (m.role === "assistant" && m.tool_calls && m.tool_calls.length > 0) {
        const contentBlocks: Anthropic.ContentBlockParam[] = [];
        if (m.content) {
          contentBlocks.push({ type: "text", text: m.content });
        }
        for (const tc of m.tool_calls) {
          let input: Record<string, unknown> = {};
          try { input = JSON.parse(tc.arguments); } catch { /* empty */ }
          contentBlocks.push({
            type: "tool_use",
            id: tc.id,
            name: tc.name,
            input,
          });
        }
        anthropicMessages.push({ role: "assistant", content: contentBlocks });
        continue;
      }

      // Regular user/assistant messages — consolidate consecutive same-role
      const lastMsg = anthropicMessages[anthropicMessages.length - 1];
      if (lastMsg && lastMsg.role === m.role && typeof lastMsg.content === "string") {
        lastMsg.content = lastMsg.content + "\n\n" + m.content;
      } else {
        anthropicMessages.push({
          role: m.role as "user" | "assistant",
          content: m.content,
        });
      }
    }

    // Convert tool definitions to Anthropic format
    const tools: Anthropic.Tool[] | undefined = params.tools?.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters as Anthropic.Tool.InputSchema,
    }));

    const requestParams: Anthropic.MessageCreateParams = {
      model: this.model,
      max_tokens: params.maxTokens ?? 4096,
      messages: anthropicMessages,
    };
    if (systemText) {
      requestParams.system = systemText;
    }
    if (tools && tools.length > 0) {
      requestParams.tools = tools;
    }

    const response = await this.client.messages.create(requestParams);

    // Extract content and tool calls
    let textContent = "";
    const toolCalls: LLMToolCall[] = [];

    for (const block of response.content) {
      if (block.type === "text") {
        textContent += block.text;
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: JSON.stringify(block.input),
        });
      }
    }

    const finishReason =
      response.stop_reason === "end_turn" ? "stop"
        : response.stop_reason === "tool_use" ? "tool_calls"
          : response.stop_reason === "max_tokens" ? "length"
            : "other";

    const usage: LLMUsage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };

    await logUsage(feature, this.model, usage);

    return {
      content: textContent || null,
      toolCalls,
      finishReason,
      usage,
    };
  }
}

// ── Factory ──

export async function getLLMClient(feature?: "chat" | "categorize" | "trips"): Promise<LLMClient> {
  const config = await getConfig();

  if (!config) {
    throw new Error("No LLM configured. Set up a provider in Settings.");
  }

  if (config.provider === "anthropic") {
    return new AnthropicLLMClient(config.apiKey, config.model, feature);
  }
  return new OpenAILLMClient(config.apiKey, config.baseUrl!, config.model, feature);
}

// ── Helper: build tool result messages ──

export function addToolResult(
  messages: LLMMessage[],
  assistantContent: string | null,
  toolCalls: LLMToolCall[],
  toolResults: Array<{ toolCallId: string; content: string }>
): LLMMessage[] {
  // Add assistant message with tool calls
  const updated = [
    ...messages,
    {
      role: "assistant" as const,
      content: assistantContent ?? "",
      tool_calls: toolCalls,
    },
  ];

  // Add tool result messages
  for (const result of toolResults) {
    updated.push({
      role: "tool" as const,
      content: result.content,
      tool_call_id: result.toolCallId,
    });
  }

  return updated;
}

// ── Create client from explicit config (for testing connection) ──

export function createLLMClientFromConfig(
  provider: string,
  apiKey: string,
  baseUrl: string | null,
  model: string
): LLMClient {
  if (provider === "anthropic") {
    return new AnthropicLLMClient(apiKey, model);
  }
  return new OpenAILLMClient(apiKey, baseUrl!, model);
}
