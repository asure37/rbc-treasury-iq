"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Sparkles, X, Send, Bot, Mic, MicOff, Volume2, VolumeX } from "lucide-react";
import { useDashboardStore } from "@/lib/store";
import { useDashboardData } from "@/lib/data-context";
import { useChatStream } from "@/lib/use-chat-stream";
import { useSpeechRecognition } from "@/lib/use-speech-recognition";
import { speakText, stopSpeaking } from "@/lib/speech-synthesis";
import { cn } from "@/lib/cn";
import { ChatMessage } from "./ChatMessage";

const STARTER_PROMPTS = [
  "Why did RBC's CET1 ratio change last quarter?",
  "How does RBC's NIM compare to peers right now?",
  "Which bank looks like an outlier on leverage ratio?",
  "Explain RBC's TLAC ratio trend this year.",
];

export function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  const [voiceMode, setVoiceMode] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { messages, isStreaming, send } = useChatStream([], (text) => {
    if (voiceMode) speakText(text);
  });

  const activeTab = useDashboardStore((s) => s.activeTab);
  const focusMetric = useDashboardStore((s) => s.focusMetric);
  const selectedBankIds = useDashboardStore((s) => s.selectedBankIds);
  const { periods } = useDashboardData();
  const latestPeriod = periods[periods.length - 1]?.period;

  const context = { activeTab, focusMetric, selectedBankIds, period: latestPeriod };

  function submit(text: string) {
    send(text, context);
    setInput("");
  }

  const { isSupported: micSupported, isListening, error: micError, start: startListening, stop: stopListening } =
    useSpeechRecognition({
      onFinalResult: (transcript) => submit(transcript),
      onInterimResult: (transcript) => setInput(transcript),
    });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => stopSpeaking, []);

  function toggleMic() {
    if (isListening) {
      stopListening();
      return;
    }
    stopSpeaking();
    startListening();
  }

  function toggleVoiceMode() {
    setVoiceMode((v) => {
      if (v) stopSpeaking();
      return !v;
    });
  }

  function close() {
    stopSpeaking();
    setIsOpen(false);
  }

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.96 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="glass-panel glow-ring fixed bottom-24 right-6 z-50 flex h-[600px] w-[380px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl"
          >
            <div className="flex items-center justify-between border-b border-border-soft px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="flex size-7 items-center justify-center rounded-full bg-gradient-to-br from-rbc-blue to-rbc-cyan">
                  <Bot className="size-4 text-white" />
                </span>
                <div>
                  <p className="font-display text-sm font-bold text-text-primary">Treasury IQ Assistant</p>
                  <p className="text-[10px] text-text-muted">Grounded in dashboard data + live search</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={toggleVoiceMode}
                  title={voiceMode ? "Voice replies: on" : "Voice replies: off"}
                  className={cn(
                    "rounded-full p-1.5 transition-colors",
                    voiceMode ? "text-rbc-cyan" : "text-text-muted hover:bg-surface-2 hover:text-text-primary"
                  )}
                >
                  {voiceMode ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
                </button>
                <button
                  onClick={close}
                  className="rounded-full p-1.5 text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>

            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {messages.length === 0 && (
                <div className="space-y-3">
                  <p className="text-xs text-text-muted">
                    Ask about capital, liquidity, or profitability trends — I&apos;ll ground answers in the dataset shown on this dashboard, plus web search and financial reasoning when useful.
                  </p>
                  <div className="flex flex-col gap-2">
                    {STARTER_PROMPTS.map((prompt) => (
                      <button
                        key={prompt}
                        onClick={() => submit(prompt)}
                        className="rounded-lg border border-border-soft bg-surface/60 px-3 py-2 text-left text-xs text-text-secondary transition-colors hover:border-rbc-cyan/40 hover:text-text-primary"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((m, i) => (
                <ChatMessage key={i} {...m} />
              ))}
              {micError && <p className="text-center text-[11px] text-down">{micError}</p>}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit(input);
              }}
              className="flex items-center gap-2 border-t border-border-soft p-3"
            >
              {micSupported && (
                <button
                  type="button"
                  onClick={toggleMic}
                  title={isListening ? "Stop listening" : "Ask by voice"}
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full border transition-colors",
                    isListening
                      ? "animate-pulse-glow border-down/40 bg-down/15 text-down"
                      : "border-border-soft bg-surface/60 text-text-muted hover:border-rbc-cyan/40 hover:text-rbc-cyan"
                  )}
                >
                  {isListening ? <MicOff className="size-3.5" /> : <Mic className="size-3.5" />}
                </button>
              )}
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={isListening ? "Listening..." : "Ask about a metric or trend..."}
                disabled={isStreaming}
                className="flex-1 rounded-full border border-border-soft bg-surface/60 px-3.5 py-2 text-xs text-text-primary outline-none placeholder:text-text-muted focus:border-rbc-cyan/50 disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={isStreaming || !input.trim()}
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-rbc-blue to-rbc-cyan text-white shadow-[0_0_18px_-4px_rgba(0,182,241,0.7)] transition-transform hover:scale-105 active:scale-95 disabled:opacity-40 disabled:hover:scale-100"
              >
                <Send className="size-3.5" />
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        onClick={() => (isOpen ? close() : setIsOpen(true))}
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.94 }}
        className="fixed bottom-6 right-6 z-50 flex size-14 items-center justify-center rounded-full bg-gradient-to-br from-rbc-blue to-rbc-cyan shadow-[0_0_32px_-6px_rgba(0,182,241,0.75)]"
      >
        <span className="absolute inset-0 animate-pulse-glow rounded-full bg-rbc-cyan/30 blur-md" />
        {isOpen ? <X className="relative size-5 text-white" /> : <Sparkles className="relative size-5 text-white" />}
      </motion.button>
    </>
  );
}
