"use client";

import { useRef, useState } from "react";
import { safeErrorText } from "@/lib/api-errors";
import type { ChatViewContext } from "@/lib/chat-context";
import type { ChartSpec } from "@/types/chart-spec";

export type ChatBlock = { type: "text"; text: string } | { type: "chart"; spec: ChartSpec };

export interface ChatStreamMessage {
  role: "user" | "assistant";
  content: string;
  blocks?: ChatBlock[];
  status?: string;
  isError?: boolean;
}

// Shared streaming client for /api/chat: parses the newline-delimited
// {t,v} protocol emitted by the route and accumulates it into a message list.
// Used by both the floating ChatWidget and the per-chart AI summary panels
// so every surface talks to the assistant the same way. Text and chart
// events are appended into an ordered `blocks` list so charts render in the
// right position relative to the surrounding text, while `content` stays a
// flat concatenation of the text for consumers that just want plain text
// (e.g. text-to-speech).
export function useChatStream(initialMessages: ChatStreamMessage[] = [], onComplete?: (text: string) => void) {
  const [messages, setMessages] = useState<ChatStreamMessage[]>(initialMessages);
  const [isStreaming, setIsStreaming] = useState(false);
  const bufferRef = useRef("");
  const textRef = useRef("");
  const blocksRef = useRef<ChatBlock[]>([]);

  async function send(text: string, context?: ChatViewContext) {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;

    const history = [...messages, { role: "user" as const, content: trimmed }];
    setMessages([...history, { role: "assistant", content: "", status: "Thinking..." }]);
    setIsStreaming(true);
    bufferRef.current = "";
    textRef.current = "";
    blocksRef.current = [];

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, context }),
      });

      if (!res.body) throw new Error("No response stream");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bufferRef.current += decoder.decode(value, { stream: true });
        const lines = bufferRef.current.split("\n");
        bufferRef.current = lines.pop() ?? "";

        for (const line of lines) {
          if (!line) continue;
          const chunk = JSON.parse(line) as { t: "text" | "status" | "chart" | "error" | "done"; v: string };
          if (chunk.t === "text") {
            textRef.current += chunk.v;
            const blocks = blocksRef.current;
            const last = blocks[blocks.length - 1];
            blocksRef.current =
              last?.type === "text"
                ? [...blocks.slice(0, -1), { type: "text", text: last.text + chunk.v }]
                : [...blocks, { type: "text", text: chunk.v }];
            setMessages((prev) => {
              const next = [...prev];
              next[next.length - 1] = { role: "assistant", content: textRef.current, blocks: blocksRef.current };
              return next;
            });
          } else if (chunk.t === "chart") {
            const spec = JSON.parse(chunk.v) as ChartSpec;
            blocksRef.current = [...blocksRef.current, { type: "chart", spec }];
            setMessages((prev) => {
              const next = [...prev];
              next[next.length - 1] = { role: "assistant", content: textRef.current, blocks: blocksRef.current };
              return next;
            });
          } else if (chunk.t === "status") {
            setMessages((prev) => {
              const next = [...prev];
              next[next.length - 1] = { role: "assistant", content: textRef.current, blocks: blocksRef.current, status: chunk.v };
              return next;
            });
          } else if (chunk.t === "error") {
            setMessages((prev) => {
              const next = [...prev];
              next[next.length - 1] = {
                role: "assistant",
                // Guarded even though the routes now send prose: an unaudited path must
                // never be able to paint a raw payload as the assistant's answer.
                content: safeErrorText(chunk.v, "The assistant hit a temporary problem answering that. Please try again."),
                isError: true,
              };
              return next;
            });
          }
        }
      }
      // A stream that ends having produced nothing would otherwise leave the placeholder
      // message stuck on its animated status forever.
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === "assistant" && !last.isError && !last.content && !(last.blocks?.length)) {
          next[next.length - 1] = {
            role: "assistant",
            content: "The assistant didn't return an answer for that. Please try again.",
            isError: true,
          };
        } else if (last?.role === "assistant" && last.status) {
          next[next.length - 1] = { ...last, status: undefined };
        }
        return next;
      });
      if (textRef.current) onComplete?.(textRef.current);
    } catch {
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = {
          role: "assistant",
          content: "Something went wrong reaching the assistant. Please try again.",
          isError: true,
        };
        return next;
      });
    } finally {
      setIsStreaming(false);
    }
  }

  return { messages, isStreaming, send };
}
