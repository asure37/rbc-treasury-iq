"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Maximize2, X, Send, Sparkles, Image as ImageIcon } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { ChatMessage } from "@/components/chat/ChatMessage";
import { useChatStream } from "@/lib/use-chat-stream";
import { exportChartAsPng } from "@/lib/export";
import { cn } from "@/lib/cn";
import type { ChatViewContext } from "@/lib/chat-context";

interface ExpandableChartCardProps {
  title: string;
  subtitle?: ReactNode;
  summaryPrompt: string;
  context: ChatViewContext;
  delay?: number;
  className?: string;
  children: ReactNode;
  renderExpanded: () => ReactNode;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function ExpandableChartCard({
  title,
  subtitle,
  summaryPrompt,
  context,
  delay,
  className,
  children,
  renderExpanded,
}: ExpandableChartCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [followUp, setFollowUp] = useState("");
  const [exporting, setExporting] = useState<"compact" | "expanded" | null>(null);
  const { messages, isStreaming, send } = useChatStream();
  const scrollRef = useRef<HTMLDivElement>(null);
  const compactChartRef = useRef<HTMLDivElement>(null);
  const expandedChartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  function open() {
    setIsOpen(true);
    if (messages.length === 0) send(summaryPrompt, context);
  }

  function submitFollowUp(e: React.FormEvent) {
    e.preventDefault();
    if (!followUp.trim()) return;
    send(followUp, context);
    setFollowUp("");
  }

  async function handlePng(which: "compact" | "expanded") {
    const node = which === "compact" ? compactChartRef.current : expandedChartRef.current;
    if (!node) return;
    setExporting(which);
    try {
      await exportChartAsPng(node, `${slugify(title)}-${Date.now()}.png`);
    } finally {
      setExporting(null);
    }
  }

  return (
    <>
      <GlassCard delay={delay} className={cn("relative p-5", className)}>
        <div className="absolute right-4 top-4 z-10 flex items-center gap-1.5">
          <button
            onClick={() => handlePng("compact")}
            disabled={exporting === "compact"}
            title="Export as PNG"
            className="flex size-7 items-center justify-center rounded-full border border-border-soft bg-surface/70 text-text-muted transition-colors hover:border-rbc-cyan/40 hover:text-rbc-cyan disabled:opacity-50"
          >
            <ImageIcon className="size-3.5" />
          </button>
          <button
            onClick={open}
            title="Expand"
            className="flex size-7 items-center justify-center rounded-full border border-border-soft bg-surface/70 text-text-muted transition-colors hover:border-rbc-cyan/40 hover:text-rbc-cyan"
          >
            <Maximize2 className="size-3.5" />
          </button>
        </div>
        <h3 className="mb-1 pr-20 font-display text-base font-semibold text-text-primary">{title}</h3>
        {subtitle}
        <div ref={compactChartRef}>{children}</div>
      </GlassCard>

      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {isOpen && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="fixed inset-0 z-50 flex items-center justify-center bg-void/70 p-4 backdrop-blur-sm"
                onClick={() => setIsOpen(false)}
              >
                <motion.div
                  initial={{ opacity: 0, y: 16, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 16, scale: 0.97 }}
                  transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                  onClick={(e) => e.stopPropagation()}
                  className="glass-panel glow-ring flex h-[85vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl"
                >
                  <div className="flex items-center justify-between border-b border-border-soft px-5 py-4">
                    <div>
                      <h3 className="font-display text-lg font-bold text-text-primary">{title}</h3>
                      {subtitle}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handlePng("expanded")}
                        disabled={exporting === "expanded"}
                        className="flex items-center gap-1.5 rounded-lg border border-border-soft bg-surface px-2.5 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:border-rbc-cyan/50 hover:text-text-primary disabled:opacity-50"
                      >
                        <ImageIcon className="size-3.5" /> PNG
                      </button>
                      <button
                        onClick={() => setIsOpen(false)}
                        className="rounded-full p-1.5 text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary"
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                  </div>

                  <div className="grid min-h-0 flex-1 gap-0 overflow-hidden lg:grid-cols-[1.4fr_1fr]">
                    <div className="flex items-center overflow-auto p-6">
                      <div ref={expandedChartRef} className="w-full">
                        {renderExpanded()}
                      </div>
                    </div>

                    <div className="flex min-h-0 flex-col border-t border-border-soft lg:border-l lg:border-t-0">
                      <div className="flex items-center gap-2 border-b border-border-soft px-4 py-3">
                        <span className="flex size-6 items-center justify-center rounded-full bg-gradient-to-br from-rbc-blue to-rbc-cyan">
                          <Sparkles className="size-3.5 text-white" />
                        </span>
                        <p className="font-display text-sm font-bold text-text-primary">Treasury IQ Insight</p>
                      </div>

                      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
                        {messages.map((m, i) => (
                          <ChatMessage key={i} {...m} />
                        ))}
                      </div>

                      <form onSubmit={submitFollowUp} className="flex items-center gap-2 border-t border-border-soft p-3">
                        <input
                          value={followUp}
                          onChange={(e) => setFollowUp(e.target.value)}
                          placeholder="Ask a follow-up..."
                          disabled={isStreaming}
                          className="flex-1 rounded-full border border-border-soft bg-surface/60 px-3.5 py-2 text-xs text-text-primary outline-none placeholder:text-text-muted focus:border-rbc-cyan/50 disabled:opacity-60"
                        />
                        <button
                          type="submit"
                          disabled={isStreaming || !followUp.trim()}
                          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-rbc-blue to-rbc-cyan text-white shadow-[0_0_18px_-4px_rgba(0,182,241,0.7)] transition-transform hover:scale-105 active:scale-95 disabled:opacity-40 disabled:hover:scale-100"
                        >
                          <Send className="size-3.5" />
                        </button>
                      </form>
                    </div>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </>
  );
}
