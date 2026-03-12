"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";

type Message = {
  role: "user" | "assistant";
  content: string;
};

type ChatSession = {
  id: number;
  title: string;
  updatedAt: string;
  messageCount: number;
};

const SUGGESTIONS = [
  "What did I spend the most on this year?",
  "Show my monthly income vs expenses",
  "What are my biggest recurring expenses?",
  "Compare my spending to last year",
  "How much did we save each month?",
];

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [showSessions, setShowSessions] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeSessionIdRef = useRef<number | null>(null);

  // Keep ref in sync
  activeSessionIdRef.current = activeSessionId;

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/chat-sessions");
      if (res.ok) setSessions(await res.json());
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  async function saveSession(msgs: Message[]) {
    try {
      const res = await fetch("/api/chat-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: activeSessionIdRef.current,
          messages: msgs,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (!activeSessionIdRef.current) {
          setActiveSessionId(data.id);
        }
        fetchSessions();
      }
    } catch {
      // ignore save errors
    }
  }

  async function loadSession(session: ChatSession) {
    try {
      const res = await fetch("/api/chat-sessions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: session.id }),
      });
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages);
        setActiveSessionId(data.id);
        setShowSessions(false);
        inputRef.current?.focus();
      }
    } catch {
      // ignore
    }
  }

  async function deleteSession(id: number, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await fetch(`/api/chat-sessions?id=${id}`, { method: "DELETE" });
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (activeSessionId === id) {
        setMessages([]);
        setActiveSessionId(null);
      }
    } catch {
      // ignore
    }
  }

  function startNewChat() {
    setMessages([]);
    setActiveSessionId(null);
    setInput("");
    setStatus("");
    setShowSessions(false);
    inputRef.current?.focus();
  }

  async function sendMessage(text: string) {
    if (!text.trim() || isLoading) return;

    const userMessage: Message = { role: "user", content: text.trim() };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);
    setStatus("");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages, sessionId: activeSessionIdRef.current }),
      });

      if (!res.ok || !res.body) {
        throw new Error("Failed to get response");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantContent = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6);
          if (!jsonStr) continue;

          try {
            const event = JSON.parse(jsonStr);

            if (event.type === "status") {
              setStatus(event.text);
            } else if (event.type === "delta") {
              setStatus("");
              assistantContent += event.text;
              setMessages([
                ...newMessages,
                { role: "assistant", content: assistantContent },
              ]);
            } else if (event.type === "error") {
              assistantContent = `Sorry, something went wrong: ${event.text}`;
              setMessages([
                ...newMessages,
                { role: "assistant", content: assistantContent },
              ]);
            } else if (event.type === "done") {
              if (!assistantContent) {
                assistantContent = "I couldn't generate a response. Please try again.";
                setMessages([
                  ...newMessages,
                  { role: "assistant", content: assistantContent },
                ]);
              }
            }
          } catch {
            // skip malformed JSON
          }
        }
      }

      // Auto-save after response
      const finalMessages = [
        ...newMessages,
        { role: "assistant" as const, content: assistantContent },
      ];
      saveSession(finalMessages);
    } catch {
      setMessages([
        ...newMessages,
        { role: "assistant", content: "Sorry, I couldn't connect to the server. Please try again." },
      ]);
    } finally {
      setIsLoading(false);
      setStatus("");
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-6rem)] md:h-[calc(100vh-4rem)]">
      {/* Header with session controls */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Chat</h2>
          <p className="text-muted-foreground">
            Ask questions about your finances
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowSessions(!showSessions)}
          >
            History{sessions.length > 0 ? ` (${sessions.length})` : ""}
          </Button>
          {(messages.length > 0 || activeSessionId) && (
            <Button variant="outline" size="sm" onClick={startNewChat}>
              New Chat
            </Button>
          )}
        </div>
      </div>

      {/* Session list dropdown */}
      {showSessions && (
        <div className="mb-4 rounded-lg border bg-background max-h-[300px] overflow-y-auto">
          {sessions.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No previous chats</p>
          ) : (
            sessions.map((s) => (
              <div
                key={s.id}
                onClick={() => loadSession(s)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter") loadSession(s); }}
                className={`w-full flex items-center justify-between px-4 py-3 text-left text-sm hover:bg-accent transition-colors border-b last:border-b-0 cursor-pointer ${
                  s.id === activeSessionId ? "bg-accent" : ""
                }`}
              >
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{s.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {s.messageCount} messages &middot; {timeAgo(s.updatedAt)}
                  </p>
                </div>
                <button
                  onClick={(e) => deleteSession(s.id, e)}
                  className="ml-2 p-1 text-muted-foreground hover:text-destructive rounded transition-colors shrink-0"
                  title="Delete chat"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto space-y-4 pb-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-6">
            <div className="text-center">
              <p className="text-lg text-muted-foreground">
                Ask me anything about your finances
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                I can look up transactions, compare spending, analyze trends, and more
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2 max-w-lg">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => sendMessage(s)}
                  className="px-3 py-2 text-sm rounded-lg border bg-background hover:bg-accent transition-colors text-left"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-4 py-2 text-sm ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted"
              }`}
            >
              {msg.role === "assistant" ? (
                <div className="prose prose-sm dark:prose-invert max-w-none break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_table]:overflow-x-auto [&_table]:block">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                </div>
              ) : (
                <div>{msg.content}</div>
              )}
            </div>
          </div>
        ))}

        {status && (
          <div className="flex justify-start">
            <div className="bg-muted rounded-lg px-4 py-2 text-sm text-muted-foreground animate-pulse">
              {status}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-t pt-4">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your finances..."
            disabled={isLoading}
            className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          />
          <Button onClick={() => sendMessage(input)} disabled={isLoading || !input.trim()}>
            {isLoading ? "..." : "Send"}
          </Button>
        </div>
      </div>
    </div>
  );
}
