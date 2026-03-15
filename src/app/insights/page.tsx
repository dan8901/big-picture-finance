"use client";

import { useState, useCallback, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type InsightType = "smart-savings" | "fun-facts" | "monthly-pulse" | "goal-check-in" | "year-in-review";
type InsightStatus = "idle" | "loading" | "streaming" | "done" | "error";

interface InsightCard {
  type: InsightType;
  title: string;
  description: string;
  icon: React.ReactNode;
  status: InsightStatus;
  content: string;
  statusText: string;
  error?: string;
}

const LightbulbIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>
);
const SparklesIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/></svg>
);
const ActivityIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/></svg>
);
const TargetIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>
);
const CalendarIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg>
);
const RefreshIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg>
);

const CARD_DEFS: Array<{ type: InsightType; title: string; description: string; icon: React.ReactNode }> = [
  { type: "smart-savings", title: "Smart Savings", description: "Actionable tips to reduce spending based on your patterns", icon: LightbulbIcon },
  { type: "fun-facts", title: "Fun Facts", description: "Surprising and interesting stats about your finances", icon: SparklesIcon },
  { type: "monthly-pulse", title: "Monthly Pulse", description: "How this month compares to your averages", icon: ActivityIcon },
  { type: "goal-check-in", title: "Goal Check-in", description: "Progress on your financial goals", icon: TargetIcon },
  { type: "year-in-review", title: "Year in Review", description: "Key highlights and trends for the year", icon: CalendarIcon },
];

function initCards(): InsightCard[] {
  return CARD_DEFS.map((d) => ({
    ...d,
    status: "idle",
    content: "",
    statusText: "",
  }));
}

export default function InsightsPage() {
  const [cards, setCards] = useState<InsightCard[]>(initCards);
  const [hasGenerated, setHasGenerated] = useState(false);
  const abortRefs = useRef<Map<InsightType, AbortController>>(new Map());

  const updateCard = useCallback((type: InsightType, updates: Partial<InsightCard>) => {
    setCards((prev) => prev.map((c) => (c.type === type ? { ...c, ...updates } : c)));
  }, []);

  const generateInsight = useCallback(async (type: InsightType) => {
    // Abort any existing request for this card
    abortRefs.current.get(type)?.abort();
    const controller = new AbortController();
    abortRefs.current.set(type, controller);

    updateCard(type, { status: "loading", content: "", statusText: "Starting...", error: undefined });

    try {
      const res = await fetch("/api/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        updateCard(type, { status: "error", error: `Request failed (${res.status})` });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let content = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === "status") {
              updateCard(type, { status: "loading", statusText: event.text });
            } else if (event.type === "delta") {
              content += event.text;
              updateCard(type, { status: "streaming", content, statusText: "" });
            } else if (event.type === "error") {
              updateCard(type, { status: "error", error: event.text });
              return;
            } else if (event.type === "done") {
              updateCard(type, { status: "done" });
              return;
            }
          } catch {
            // skip malformed JSON
          }
        }
      }

      // Stream ended without explicit done event
      updateCard(type, { status: content ? "done" : "error", error: content ? undefined : "No response received" });
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      updateCard(type, { status: "error", error: (err as Error).message });
    }
  }, [updateCard]);

  const generateAll = useCallback(() => {
    setHasGenerated(true);
    for (const def of CARD_DEFS) {
      generateInsight(def.type);
    }
  }, [generateInsight]);

  const isAnyLoading = cards.some((c) => c.status === "loading" || c.status === "streaming");

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">AI Insights</h2>
          <p className="text-muted-foreground">
            Generate personalized financial insights powered by AI
          </p>
        </div>
        <Button
          onClick={generateAll}
          disabled={isAnyLoading}
          variant={hasGenerated ? "outline" : "default"}
          className="shrink-0"
        >
          {isAnyLoading ? (
            <>
              <svg className="mr-2 h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
              Generating...
            </>
          ) : hasGenerated ? (
            "Regenerate"
          ) : (
            "Generate Insights"
          )}
        </Button>
      </div>

      {/* Top 4 cards in 2x2 grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {cards.slice(0, 4).map((card) => (
          <InsightCardComponent
            key={card.type}
            card={card}
            hasGenerated={hasGenerated}
            onRegenerate={() => generateInsight(card.type)}
          />
        ))}
      </div>

      {/* Year in Review full width */}
      <InsightCardComponent
        card={cards[4]}
        hasGenerated={hasGenerated}
        onRegenerate={() => generateInsight(cards[4].type)}
      />
    </div>
  );
}

function InsightCardComponent({
  card,
  hasGenerated,
  onRegenerate,
}: {
  card: InsightCard;
  hasGenerated: boolean;
  onRegenerate: () => void;
}) {
  const isActive = card.status === "loading" || card.status === "streaming";

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <span className="text-muted-foreground">{card.icon}</span>
            {card.title}
          </CardTitle>
          {hasGenerated && card.status !== "loading" && card.status !== "streaming" && (
            <button
              onClick={onRegenerate}
              className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-accent"
              title={`Regenerate ${card.title}`}
            >
              {RefreshIcon}
            </button>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex-1">
        {card.status === "idle" && (
          <p className="text-sm text-muted-foreground">{card.description}</p>
        )}

        {card.status === "loading" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <svg className="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
            {card.statusText || "Analyzing your data..."}
          </div>
        )}

        {(card.status === "streaming" || card.status === "done") && card.content && (
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {card.content}
            </ReactMarkdown>
          </div>
        )}

        {card.status === "error" && (
          <div className="space-y-2">
            <p className="text-sm text-red-500">{card.error || "Something went wrong"}</p>
            <Button variant="outline" size="sm" onClick={onRegenerate}>
              Retry
            </Button>
          </div>
        )}

        {isActive && card.status === "streaming" && (
          <span className="inline-block w-1.5 h-4 bg-foreground/50 animate-pulse ml-0.5 align-text-bottom" />
        )}
      </CardContent>
    </Card>
  );
}
