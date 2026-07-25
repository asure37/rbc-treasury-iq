"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Fingerprint, KeyRound, ShieldCheck, Loader2, Check } from "lucide-react";
import { Mark } from "@/components/ui/Mark";
import { useAuthStore } from "@/lib/auth-store";
import { cn } from "@/lib/cn";
import { GeometricBackdrop } from "./GeometricBackdrop";
import { CandlestickBackdrop } from "./CandlestickBackdrop";
import { BarChartBackdrop } from "./BarChartBackdrop";
import type { LoginResponse } from "@/types/auth";

export function LoginScreen() {
  const login = useAuthStore((s) => s.login);
  const [employeeId, setEmployeeId] = useState("");
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<{ employeeId: string; firstName: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, passcode }),
      });
      const data = (await res.json()) as LoginResponse;
      if (data.ok) {
        setSuccess({ employeeId: data.employeeId, firstName: data.firstName });
        setTimeout(() => login(data.employeeId, data.firstName), 700);
      } else {
        setError(data.error);
        setShake((s) => s + 1);
        setSubmitting(false);
      }
    } catch {
      setError("Couldn't reach the authentication service. Please try again.");
      setShake((s) => s + 1);
      setSubmitting(false);
    }
  };

  return (
    <motion.div
      exit={{ opacity: 0, scale: 1.05, filter: "blur(10px)" }}
      transition={{ duration: 0.5, ease: [0.76, 0, 0.24, 1] }}
      className="relative flex min-h-dvh w-full flex-col items-center justify-center overflow-hidden"
    >
      <GeometricBackdrop />
      <CandlestickBackdrop />
      <BarChartBackdrop align="left" />
      <BarChartBackdrop align="right" />

      <div className="flex w-full flex-1 items-center justify-center px-4">
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="relative w-full max-w-md"
        >
          <motion.div
            key={shake}
            animate={shake ? { x: [0, -10, 10, -8, 8, -4, 4, 0] } : {}}
            transition={{ duration: 0.5 }}
            className="glass-panel glow-ring relative rounded-3xl p-8"
          >
            <div className="flex flex-col items-center text-center">
              <motion.div
                animate={{ boxShadow: ["0 0 0px rgba(0,182,241,0.0)", "0 0 32px rgba(0,182,241,0.45)", "0 0 0px rgba(0,182,241,0.0)"] }}
                transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                className="rounded-2xl"
              >
                <Mark size={48} />
              </motion.div>
              <h1 className="mt-4 font-display text-2xl font-bold text-text-primary">
                RBC <span className="text-gradient-blue">Treasury Intelligence</span>
              </h1>
              <p className="mt-1 text-sm text-text-muted">Secure sign-in for Corporate Treasury team members</p>
            </div>

            <form onSubmit={handleSubmit} className="mt-8 space-y-4">
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-text-muted">
                  <Fingerprint className="size-3.5" /> Login ID
                </label>
                <input
                  type="text"
                  autoComplete="username"
                  value={employeeId}
                  onChange={(e) => setEmployeeId(e.target.value)}
                  placeholder="Enter your Login ID"
                  disabled={!!success}
                  className="w-full rounded-xl border border-border-soft bg-surface/70 px-4 py-2.5 font-mono text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted/50 focus:border-rbc-cyan/60 focus:ring-1 focus:ring-rbc-cyan/30 disabled:opacity-60"
                  required
                />
              </div>

              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-text-muted">
                  <KeyRound className="size-3.5" /> Passcode
                </label>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  placeholder="Enter passcode"
                  disabled={!!success}
                  className="w-full rounded-xl border border-border-soft bg-surface/70 px-4 py-2.5 text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted/50 focus:border-rbc-cyan/60 focus:ring-1 focus:ring-rbc-cyan/30 disabled:opacity-60"
                  required
                />
              </div>

              {error && (
                <motion.p
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  className="rounded-lg bg-down/10 px-3 py-2 text-xs font-medium text-down"
                >
                  {error}
                </motion.p>
              )}

              <button
                type="submit"
                disabled={submitting || !!success}
                className={cn(
                  "relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-r from-rbc-blue to-rbc-cyan py-3 text-sm font-semibold text-white shadow-[0_0_32px_-8px_rgba(0,182,241,0.6)] transition-transform hover:scale-[1.01] active:scale-[0.99]",
                  (submitting || success) && "opacity-95"
                )}
              >
                <AnimatePresence mode="wait" initial={false}>
                  {success ? (
                    <motion.span
                      key="success"
                      initial={{ opacity: 0, scale: 0.6 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ type: "spring", stiffness: 400, damping: 18 }}
                      className="flex items-center gap-2"
                    >
                      <Check className="size-4" />
                      Access Granted
                    </motion.span>
                  ) : (
                    <motion.span key="default" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2">
                      {submitting ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
                      {submitting ? "Verifying..." : "Sign In"}
                    </motion.span>
                  )}
                </AnimatePresence>
              </button>
            </form>

            <p className="mt-6 text-center text-[11px] text-text-muted">
              Internal prototype &middot; Corporate Treasury access only &middot; contact your team lead for credentials
            </p>
          </motion.div>
        </motion.div>
      </div>
    </motion.div>
  );
}
