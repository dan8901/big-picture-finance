import { NextRequest } from "next/server";
import OpenAI from "openai";
import { toolDefinitions, executeTool } from "./tools";
import { db } from "@/db";
import { chatSessions } from "@/db/schema";
import { eq } from "drizzle-orm";
import type {
  ChatCompletionMessageParam,
  ChatCompletionToolMessageParam,
  ChatCompletionMessageFunctionToolCall,
} from "openai/resources/chat/completions";

const SYSTEM_PROMPT = `You are a helpful financial assistant for a dual-country (US/Israel) household. You have access to tools that query the household's financial database.

Today's date: ${new Date().toISOString().split("T")[0]}

Key facts about the data:
- Expenses are NEGATIVE amounts, income is POSITIVE
- Currencies: USD and ILS. Convert ILS to USD for comparisons unless the user asks for ILS
- 9 expense categories: Food & Dining, Transportation, Housing & Utilities, Health & Insurance, Shopping & Clothing, Entertainment & Leisure, Transfers, Government & Taxes, Other
- "Recurring" means the transaction description appears in 3+ different months
- The household has multiple account owners — you can filter by owner
- Excluded transactions are hidden by default (internal transfers, stock trades, etc.)
- Manual income entries track salary, RSU, ESPP, pension, and keren hishtalmut (Israeli savings plan)

Tool usage strategy:
- For broad questions like "give me insights", "how are my finances", or "point out anything interesting" — start with get_financial_summary to get a complete overview, then drill down with other tools if needed
- For specific questions about a category, merchant, or date — use the targeted tools directly

Response guidelines:
- Format currency amounts properly: $1,234.56 or ₪1,234.56
- Be concise but include specific numbers
- Use bullet points for lists
- When comparing periods, show both values and the % change
- If you need more data to answer well, make additional tool calls
- For broad insight questions, highlight anomalies, trends, and notable patterns — don't just recite numbers
- If you're unsure about something, say so honestly`;

const MAX_TOOL_ROUNDS = 5;
const MAX_CONTEXT_CHARS = 300_000; // ~75K tokens, leaves room for tools + response
const RECENT_PAIRS_TO_KEEP = 10; // Keep last 10 user/assistant exchanges verbatim

function sseEvent(type: string, data: Record<string, unknown>): string {
  return `data: ${JSON.stringify({ type, ...data })}\n\n`;
}

function estimateChars(messages: Array<{ role: string; content: string }>): number {
  return messages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0);
}

async function generateSummary(
  client: OpenAI,
  model: string,
  messages: Array<{ role: string; content: string }>
): Promise<string> {
  const conversation = messages
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n\n");

  const response = await client.chat.completions.create({
    model,
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `Summarize this financial conversation concisely. Capture key questions asked, data discussed, numbers mentioned, conclusions reached, and any ongoing topics. This summary will be used as context for continuing the conversation.\n\n${conversation}`,
      },
    ],
  });

  return response.choices[0]?.message?.content ?? "Previous conversation context unavailable.";
}

async function trimMessages(
  client: OpenAI,
  model: string,
  messages: Array<{ role: string; content: string }>,
  sessionId: number | null
): Promise<ChatCompletionMessageParam[]> {
  const totalChars = estimateChars(messages) + SYSTEM_PROMPT.length;

  // Under limit — send everything as-is
  if (totalChars <= MAX_CONTEXT_CHARS) {
    return [
      { role: "system", content: SYSTEM_PROMPT },
      ...messages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    ];
  }

  // Over limit — need to summarize older messages
  // Find how many recent messages to keep (up to RECENT_PAIRS_TO_KEEP pairs = 20 messages)
  const recentCount = Math.min(messages.length, RECENT_PAIRS_TO_KEEP * 2);
  const olderMessages = messages.slice(0, messages.length - recentCount);
  const recentMessages = messages.slice(messages.length - recentCount);

  // Try to load cached summary from session
  let summary: string | null = null;
  if (sessionId) {
    const rows = await db
      .select({ summary: chatSessions.summary })
      .from(chatSessions)
      .where(eq(chatSessions.id, sessionId));
    summary = rows[0]?.summary ?? null;
  }

  // Generate summary if we don't have a cached one or older messages have grown
  if (!summary && olderMessages.length > 0) {
    summary = await generateSummary(client, model, olderMessages);

    // Cache it
    if (sessionId) {
      await db
        .update(chatSessions)
        .set({ summary })
        .where(eq(chatSessions.id, sessionId));
    }
  }

  const result: ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
  ];

  if (summary) {
    result.push({
      role: "system",
      content: `Previous conversation summary:\n${summary}`,
    });
  }

  result.push(
    ...recentMessages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }))
  );

  return result;
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { messages, sessionId } = body as {
    messages: Array<{ role: string; content: string }>;
    sessionId?: number | null;
  };

  if (!messages || messages.length === 0) {
    return new Response(
      sseEvent("error", { text: "No messages provided" }),
      { headers: { "Content-Type": "text/event-stream" } }
    );
  }

  const client = new OpenAI({
    apiKey: process.env.NVIDIA_API_KEY,
    baseURL: process.env.NVIDIA_BASE_URL,
  });

  const model = process.env.NVIDIA_MODEL ?? "aws/anthropic/bedrock-claude-opus-4-6";

  // Build message history with optional summarization for long conversations
  const apiMessages = await trimMessages(client, model, messages, sessionId ?? null);

  // Create a streaming response
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        let round = 0;

        while (round < MAX_TOOL_ROUNDS) {
          round++;

          const response = await client.chat.completions.create({
            model,
            max_tokens: 4096,
            messages: apiMessages,
            tools: toolDefinitions,
          });

          const choice = response.choices[0];
          if (!choice) break;

          const message = choice.message;

          // If the model wants to call tools
          const fnCalls = (message.tool_calls ?? []).filter(
            (tc): tc is ChatCompletionMessageFunctionToolCall => tc.type === "function"
          );

          if (fnCalls.length > 0) {
            // Send status to client
            const toolNames = fnCalls.map((tc) => tc.function.name).join(", ");
            controller.enqueue(
              encoder.encode(sseEvent("status", { text: `Querying: ${toolNames}...` }))
            );

            // Add assistant message with tool calls
            apiMessages.push({
              role: "assistant",
              content: message.content ?? "",
              tool_calls: fnCalls,
            });

            // Execute each tool call
            const toolResults: ChatCompletionToolMessageParam[] = [];
            for (const toolCall of fnCalls) {
              let args: Record<string, unknown> = {};
              try {
                args = JSON.parse(toolCall.function.arguments);
              } catch {
                // empty args
              }

              try {
                const result = await executeTool(toolCall.function.name, args);
                toolResults.push({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: JSON.stringify(result),
                });
              } catch (err) {
                toolResults.push({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: JSON.stringify({
                    error: `Tool execution failed: ${err instanceof Error ? err.message : "unknown error"}`,
                  }),
                });
              }
            }

            apiMessages.push(...toolResults);
            continue; // Loop for another round
          }

          // No tool calls — stream the final text response
          if (message.content) {
            controller.enqueue(
              encoder.encode(sseEvent("delta", { text: message.content }))
            );
          }
          break;
        }

        controller.enqueue(encoder.encode(sseEvent("done", {})));
        controller.close();
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Unknown error";
        controller.enqueue(
          encoder.encode(sseEvent("error", { text: errorMsg }))
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
