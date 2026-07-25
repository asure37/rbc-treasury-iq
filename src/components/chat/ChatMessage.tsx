"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/cn";
import { ChatChartBlock } from "./ChatChartBlock";
import type { ChatBlock } from "@/lib/use-chat-stream";

export interface ChatMessageData {
  role: "user" | "assistant";
  content: string;
  blocks?: ChatBlock[];
  status?: string;
  isError?: boolean;
}

export function ChatMessage({ role, content, blocks, status, isError }: ChatMessageData) {
  const isUser = role === "user";
  const hasBlocks = !!blocks && blocks.length > 0;

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed",
          isUser
            ? "bg-gradient-to-br from-rbc-blue to-rbc-blue-2 text-white"
            : isError
              ? "border border-down/30 bg-down/10 text-down"
              : "glass-panel text-text-primary"
        )}
      >
        {!isUser && !hasBlocks && content.length === 0 && status ? (
          <span className="flex items-center gap-1.5 text-text-muted">
            <span className="flex gap-0.5">
              <span className="size-1.5 animate-bounce rounded-full bg-rbc-cyan [animation-delay:-0.3s]" />
              <span className="size-1.5 animate-bounce rounded-full bg-rbc-cyan [animation-delay:-0.15s]" />
              <span className="size-1.5 animate-bounce rounded-full bg-rbc-cyan" />
            </span>
            {status}
          </span>
        ) : isUser ? (
          <p className="whitespace-pre-wrap">{content}</p>
        ) : hasBlocks ? (
          <div className="space-y-2">
            {blocks!.map((block, i) =>
              block.type === "text" ? (
                <div key={i} className="chat-markdown">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.text}</ReactMarkdown>
                </div>
              ) : (
                <ChatChartBlock key={i} spec={block.spec} />
              )
            )}
            {status && (
              <span className="flex items-center gap-1.5 text-xs text-text-muted">
                <span className="flex gap-0.5">
                  <span className="size-1.5 animate-bounce rounded-full bg-rbc-cyan [animation-delay:-0.3s]" />
                  <span className="size-1.5 animate-bounce rounded-full bg-rbc-cyan [animation-delay:-0.15s]" />
                  <span className="size-1.5 animate-bounce rounded-full bg-rbc-cyan" />
                </span>
                {status}
              </span>
            )}
          </div>
        ) : (
          <div className="chat-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
