import { NextRequest } from "next/server";
import { toolDefinitions, executeTool } from "./tools";
import { db } from "@/db";
import { chatSessions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getLLMClient, addToolResult, type LLMMessage, type LLMToolDefinition } from "@/lib/llm";
import { getSystemPrompt } from "@/lib/chat-system-prompt";

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
  const systemPrompt = await getSystemPrompt();
  const totalChars = estimateChars(messages) + systemPrompt.length;

  // Under limit — send everything as-is
  if (totalChars <= MAX_CONTEXT_CHARS) {
    return [
      { role: "system", content: systemPrompt },
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
    { role: "system", content: systemPrompt },
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
