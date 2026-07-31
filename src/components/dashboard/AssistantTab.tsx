"use client";

import { useEffect, useRef, useState } from "react";
import { Send, Bot, Mic, MicOff, Volume2, VolumeX } from "lucide-react";
import { useDashboardStore } from "@/lib/store";
import { useDashboardData } from "@/lib/data-context";
import { useChatStream } from "@/lib/use-chat-stream";
import { useSpeechRecognition } from "@/lib/use-speech-recognition";
import { speakText, stopSpeaking } from "@/lib/speech-synthesis";
import { cn } from "@/lib/cn";
import { GlassCard } from "@/components/ui/GlassCard";
import { DataSourcingPanel } from "./DataSourcingPanel";
import { ChatMessage } from "@/components/chat/ChatMessage";

const STARTER_PROMPTS = [
  "Why did RBC's CET1 ratio change last quarter?",
  "How does RBC's NIM compare to peers right now?",
  "Which bank looks like an outlier on leverage ratio?",
  "Explain RBC's TLAC ratio trend this year.",
  "How does RBC's balance sheet size compare to TD's?",
  "Summarize RBC's liquidity position (LCR and NSFR) this quarter.",
];

export function AssistantTab() {
  const [input, setInput] = useState("");
  const [voiceMode, setVoiceMode] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { messages, isStreaming, send } = useChatStream([], (text) => {
    if (voiceMode) speakText(text);
  });

  const focusMetric = useDashboardStore((s) => s.focusMetric);
  const selectedBankIds = useDashboardStore((s) => s.selectedBankIds);
  const { periods } = useDashboardData();
  const latestPeriod = periods[periods.length - 1]?.period;

  const context = { activeTab: "assistant", focusMetric, selectedBankIds, period: latestPeriod };

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

  return (
    <div className="flex min-h-[calc(100vh-11rem)] flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-full bg-gradient-to-br from-rbc-blue to-rbc-cyan shadow-[0_0_24px_-6px_rgba(0,182,241,0.7)]">
            <Bot className="size-5 text-white" />
          </span>
          <div>
            <h2 className="font-display text-lg font-bold text-text-primary">Treasury IQ Assistant</h2>
            <p className="text-xs text-text-muted">
              Grounded in this dashboard&apos;s dataset, precomputed variance analysis, live web search, and financial reasoning &mdash; every data point is cited.
            </p>
          </div>
        </div>
        <button
          onClick={toggleVoiceMode}
          title={voiceMode ? "Voice replies: on" : "Voice replies: off"}
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
            voiceMode
              ? "border-rbc-cyan/40 bg-rbc-cyan/10 text-rbc-cyan"
              : "border-border-soft bg-surface/60 text-text-muted hover:text-text-primary"
          )}
        >
          {voiceMode ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}
          Voice replies
        </button>
      </div>

      <DataSourcingPanel />

      <GlassCard className="flex min-h-[28rem] flex-1 flex-col overflow-hidden">
        <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6">
          {messages.length === 0 && (
            <div className="mx-auto max-w-2xl space-y-4 pt-6">
              <p className="text-center text-sm text-text-muted">
                Ask about capital, liquidity, or profitability trends across RBC and its Canadian peers. Try one of these, or ask your own question &mdash; by voice too, using the mic button.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {STARTER_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => submit(prompt)}
                    className="rounded-xl border border-border-soft bg-surface/60 px-4 py-3 text-left text-sm text-text-secondary transition-colors hover:border-rbc-cyan/40 hover:text-text-primary"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="mx-auto max-w-3xl space-y-4">
            {messages.map((m, i) => (
              <ChatMessage key={i} {...m} />
            ))}
            {micError && <p className="text-center text-xs text-down">{micError}</p>}
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(input);
          }}
          className="mx-auto flex w-full max-w-3xl items-center gap-2 border-t border-border-soft p-4"
        >
          {micSupported && (
            <button
              type="button"
              onClick={toggleMic}
              title={isListening ? "Stop listening" : "Ask by voice"}
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-full border transition-colors",
                isListening
                  ? "animate-pulse-glow border-down/40 bg-down/15 text-down"
                  : "border-border-soft bg-surface/60 text-text-muted hover:border-rbc-cyan/40 hover:text-rbc-cyan"
              )}
            >
              {isListening ? <MicOff className="size-4" /> : <Mic className="size-4" />}
            </button>
          )}
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={isListening ? "Listening..." : "Ask about a metric, trend, or comparison..."}
            disabled={isStreaming}
            className="flex-1 rounded-full border border-border-soft bg-surface/60 px-4 py-2.5 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-rbc-cyan/50 disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={isStreaming || !input.trim()}
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-rbc-blue to-rbc-cyan text-white shadow-[0_0_18px_-4px_rgba(0,182,241,0.7)] transition-transform hover:scale-105 active:scale-95 disabled:opacity-40 disabled:hover:scale-100"
          >
            <Send className="size-4" />
          </button>
        </form>
      </GlassCard>
    </div>
  );
}
