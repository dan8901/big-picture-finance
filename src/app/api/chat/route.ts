import { NextRequest } from "next/server";
import { toolDefinitions, executeTool } from "./tools";
import { db } from "@/db";
import { chatSessions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getLLMClient, addToolResult, type LLMMessage, type LLMToolDefinition } from "@/lib/llm";

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
- Financial goals track budget caps (spending limits) and savings targets. Goal periods are "YYYY-MM" for monthly or "YYYY" for annual.

Tool usage strategy:
- For broad questions like "give me insights", "how are my finances", or "point out anything interesting" — start with get_financial_summary to get a complete overview, then drill down with other tools if needed
- For specific questions about a category, merchant, or date — use the targeted tools directly
- For goal-related questions (budget goals, savings targets, streaks, "why did I miss a goal") — start with get_goals, then get_goal_achievements for specific periods, then drill down with query_transactions or get_top_merchants to identify the transactions that caused overspend

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
  messages: Array<{ role: string; content: string }>
): Promise<string> {
  const conversation = messages
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n\n");

  const llm = await getLLMClient("chat");
  const response = await llm.complete({
    messages: [
      {
        role: "user",
        content: `Summarize this financial conversation concisely. Capture key questions asked, data discussed, numbers mentioned, conclusions reached, and any ongoing topics. This summary will be used as context for continuing the conversation.\n\n${conversation}`,
      },
    ],
    maxTokens: 1024,
    feature: "chat",
  });

  return response.content ?? "Previous conversation context unavailable.";
}

async function trimMessages(
  messages: Array<{ role: string; content: string }>,
  sessionId: number | null
): Promise<LLMMessage[]> {
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
    summary = await generateSummary(olderMessages);

    // Cache it
    if (sessionId) {
      await db
        .update(chatSessions)
        .set({ summary })
        .where(eq(chatSessions.id, sessionId));
    }
  }

  const result: LLMMessage[] = [
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

  // Build message history with optional summarization for long conversations
  let apiMessages = await trimMessages(messages, sessionId ?? null);

  // Convert tool definitions to LLM format
  const llmToolDefs: LLMToolDefinition[] = toolDefinitions
    .filter((t): t is Extract<typeof t, { type: "function" }> => t.type === "function")
    .map((t) => ({
      type: "function" as const,
      function: {
        name: t.function.name,
        description: t.function.description ?? "",
        parameters: t.function.parameters as Record<string, unknown>,
      },
    }));

  // Create a streaming response
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const llm = await getLLMClient("chat");
        let round = 0;

        while (round < MAX_TOOL_ROUNDS) {
          round++;

          const response = await llm.complete({
            messages: apiMessages,
            tools: llmToolDefs,
            maxTokens: 4096,
            feature: "chat",
          });

          if (response.toolCalls.length > 0) {
            // Send status to client
            const toolNames = response.toolCalls.map((tc) => tc.name).join(", ");
            controller.enqueue(
              encoder.encode(sseEvent("status", { text: `Querying: ${toolNames}...` }))
            );

            // Execute each tool call
            const toolResults: Array<{ toolCallId: string; content: string }> = [];
            for (const toolCall of response.toolCalls) {
              let args: Record<string, unknown> = {};
              try {
                args = JSON.parse(toolCall.arguments);
              } catch {
                // empty args
              }

              try {
                const result = await executeTool(toolCall.name, args);
                toolResults.push({
                  toolCallId: toolCall.id,
                  content: JSON.stringify(result),
                });
              } catch (err) {
                toolResults.push({
                  toolCallId: toolCall.id,
                  content: JSON.stringify({
                    error: `Tool execution failed: ${err instanceof Error ? err.message : "unknown error"}`,
                  }),
                });
              }
            }

            apiMessages = addToolResult(apiMessages, response.content, response.toolCalls, toolResults);
            continue; // Loop for another round
          }

          // No tool calls — stream the final text response
          if (response.content) {
            controller.enqueue(
              encoder.encode(sseEvent("delta", { text: response.content }))
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
