"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { Mark } from "@/components/ui/Mark";
import { useAuthStore } from "@/lib/auth-store";

const WORDS = ["Welcome", "to", "Treasury", "IQ,"];

interface Particle {
  id: number;
  x: number;
  y: number;
  size: number;
  delay: number;
  duration: number;
}

export function WelcomeScreen({ onContinue }: { onContinue: () => void }) {
  const firstName = useAuthStore((s) => s.firstName) ?? "there";
  const [showButton, setShowButton] = useState(false);

  // Lazy useState initializer (not useMemo) because it must run exactly once
  // per mount — Math.random() here would be impure inside a recomputable memo.
  const [particles] = useState<Particle[]>(() =>
    Array.from({ length: 28 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: 2 + Math.random() * 3,
      delay: Math.random() * 3,
      duration: 3 + Math.random() * 4,
    }))
  );

  const allWords = [...WORDS, `${firstName}`];
  const revealDelay = 0.35;
  const stagger = 0.14;
  const lastWordDelay = revealDelay + (allWords.length - 1) * stagger;

  return (
    <motion.div
      exit={{ opacity: 0, scale: 1.08, filter: "blur(16px)" }}
      transition={{ duration: 0.7, ease: [0.76, 0, 0.24, 1] }}
      className="relative flex min-h-dvh w-full items-center justify-center overflow-hidden px-4"
    >
      {/* ambient glow orbs */}
      <motion.div
        animate={{ scale: [1, 1.25, 1], opacity: [0.35, 0.6, 0.35] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        className="pointer-events-none absolute left-1/2 top-1/2 size-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-rbc-blue-2/25 blur-[120px]"
      />
      <motion.div
        animate={{ scale: [1.2, 1, 1.2], opacity: [0.25, 0.5, 0.25] }}
        transition={{ duration: 7, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
        className="pointer-events-none absolute left-1/2 top-1/2 size-[680px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-rbc-cyan/15 blur-[140px]"
      />

      {/* drifting particles */}
      {particles.map((p) => (
        <motion.span
          key={p.id}
          className="pointer-events-none absolute rounded-full bg-rbc-cyan"
          style={{ left: `${p.x}%`, top: `${p.y}%`, width: p.size, height: p.size }}
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0.8, 0], y: [0, -30, -60] }}
          transition={{ duration: p.duration, delay: p.delay, repeat: Infinity, ease: "easeInOut" }}
        />
      ))}

      {/* concentric rings expanding from the mark */}
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          initial={{ scale: 0.3, opacity: 0.5 }}
          animate={{ scale: 3.2, opacity: 0 }}
          transition={{ duration: 3.4, repeat: Infinity, delay: i * 1.1, ease: "easeOut" }}
          className="pointer-events-none absolute size-24 rounded-full border border-rbc-cyan/40"
        />
      ))}

      <div className="relative z-10 flex flex-col items-center text-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.4, rotate: -20 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        >
          <Mark size={56} />
        </motion.div>

        <h1 className="mt-8 flex max-w-3xl flex-col items-center gap-y-1 font-display text-4xl font-bold sm:text-5xl md:text-6xl">
          <span className="flex flex-wrap items-baseline justify-center gap-x-3">
            {WORDS.map((word, i) => (
              <motion.span
                key={`${word}-${i}`}
                initial={{ opacity: 0, y: 28, filter: "blur(6px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                transition={{ duration: 0.6, delay: revealDelay + i * stagger, ease: [0.16, 1, 0.3, 1] }}
                className="text-text-primary"
              >
                {word}
              </motion.span>
            ))}
          </span>
          <motion.span
            initial={{ opacity: 0, y: 28, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.6, delay: lastWordDelay, ease: [0.16, 1, 0.3, 1] }}
            onAnimationComplete={() => setShowButton(true)}
            className="text-gradient-blue shimmer-text"
          >
            {firstName}
          </motion.span>
        </h1>

        <motion.button
          initial={{ opacity: 0, y: 16 }}
          animate={showButton ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          onClick={onContinue}
          disabled={!showButton}
          className="group mt-10 flex items-center gap-2 rounded-full bg-gradient-to-r from-rbc-blue to-rbc-cyan px-8 py-3.5 text-sm font-semibold text-white shadow-[0_0_48px_-10px_rgba(0,182,241,0.7)] transition-transform hover:scale-105 active:scale-95"
        >
          Continue to Dashboard
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
        </motion.button>
      </div>
    </motion.div>
  );
}
