"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useGlobalStore } from "@/lib/store";
import { Progress } from "@/components/ui/progress";

// Overlay central de proceso largo (Fase 8/Fase 2, G1) — un único punto de feedback para las
// operaciones que hoy solo deshabilitan un botón (fit con adstock+Hill, best_stepwise, preview de
// Predict, optimizador de presupuesto, upload de datasets). Alimentado por
// lib/store.ts::longOperation, nunca montado condicionalmente por página para que cubra toda la
// navegación (incluido el Sidebar) mientras la operación está en curso.
export function GlobalLoadingOverlay() {
  const { active, label, progress } = useGlobalStore((s) => s.longOperation);
  const shouldReduceMotion = useReducedMotion();

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4"
          role="status"
          aria-live="polite"
          aria-busy="true"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.15 }}
        >
          <motion.div
            className="flex w-full max-w-xs flex-col items-center gap-3 rounded-xl border border-line bg-surface p-6 text-center shadow-[var(--shadow-soft)]"
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.18, ease: "easeOut" }}
          >
            {progress == null ? (
              <span
                className="h-8 w-8 shrink-0 animate-spin rounded-full border-[3px] border-accent border-t-transparent"
                aria-hidden
              />
            ) : (
              <div className="w-full space-y-1">
                <Progress value={progress} />
                <p className="text-xs text-muted">{Math.round(progress)}%</p>
              </div>
            )}
            {label && <p className="text-sm text-ink">{label}</p>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
