"use client";

import React, { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
};

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ open, onClose, title, children }: ModalProps) {
  const tCommon = useTranslations("common");
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // A05-R1: diálogo accesible — foco atrapado dentro mientras está abierto, devuelto al elemento
  // que lo abrió al cerrar (si no, el foco cae al `body` y un usuario de teclado/lector de
  // pantalla pierde su lugar en la página).
  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const firstFocusable = dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (firstFocusable ?? dialogRef.current)?.focus();

    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", listener);
    return () => {
      window.removeEventListener("keydown", listener);
      previouslyFocused.current?.focus();
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            className="w-full max-w-lg rounded-xl border border-line bg-surface p-6 shadow-[var(--shadow-soft)] focus:outline-none"
            onClick={(event) => event.stopPropagation()}
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 id={titleId} className="text-lg font-semibold text-ink">
                {title}
              </h3>
              <button onClick={onClose} aria-label={tCommon("close")} className="rounded-full p-2 hover:bg-surface-2">
                <X className="h-4 w-4" />
              </button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
