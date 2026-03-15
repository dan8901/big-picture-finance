import { NextRequest } from "next/server";
import { toolDefinitions, executeTool } from "../chat/tools";
import { getLLMClient, addToolResult, type LLMMessage, type LLMToolDefinition } from "@/lib/llm";
import { getSystemPrompt } from "@/lib/chat-system-prompt";

const MAX_TOOL_ROUNDS = 5;

const INSIGHT_PROMPTS: Record<string, string> = {
  "smart-savings": `Analyze my spending patterns and give me 3-5 specific, actionable tips to reduce expenses. Reference actual merchants, categories, and amounts from my data. Focus on recurring charges I might not need, categories where I spend more than average, and easy wins. Be specific with numbers. Use markdown formatting with headers for each tip.`,

  "fun-facts": `Give me 5 fun, surprising, or interesting facts about my finances. Things like: my most frequent merchant, what day of the week I spend the most, my biggest single purchase, how many transactions I have, quirky patterns you notice. Make it entertaining and personal. Use emojis. Use markdown formatting.`,

  "monthly-pulse": `Compare my spending this month to my monthly averages. Which categories am I over or under? Am I on track for the month? Highlight anything unusual. Give a brief overall health assessment (1-2 sentences) then break down by category. Use markdown with a summary at the top.`,

  "goal-check-in": `Review my financial goals and give me a progress update. For each goal, tell me where I stand, whether I'm on track, and one specific action I can take to stay on track or improve. If I have streaks, mention them. Be encouraging but honest. Use markdown formatting.`,

  "year-in-review": `Give me a year-in-review summary of my finances. Cover: total income vs expenses, savings rate, top spending categories, biggest changes from previous periods, notable transactions or events, and an overall assessment. Keep it concise but comprehensive. Use markdown formatting with clear sections.`,
};

function sseEvent(type: string, data: Record<string, unknown>): string {
  return `data: ${JSON.stringify({ type, ...data })}\n\n`;
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { type } = body as { type: string };

  const prompt = INSIGHT_PROMPTS[type];
  if (!prompt) {
    return new Response(
      sseEvent("error", { text: `Unknown insight type: ${type}` }),
      { headers: { "Content-Type": "text/event-stream" } }
    );
  }

  const systemPrompt = await getSystemPrompt();

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

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const llm = await getLLMClient("chat");
        let apiMessages: LLMMessage[] = [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ];
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
            const toolNames = response.toolCalls.map((tc) => tc.name).join(", ");
            controller.enqueue(
              encoder.encode(sseEvent("status", { text: `Querying: ${toolNames}...` }))
            );

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
            continue;
          }

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
