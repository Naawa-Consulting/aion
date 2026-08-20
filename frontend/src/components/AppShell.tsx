"use client";

import React, { useState } from "react";
import { MotionConfig } from "framer-motion";
import { useTranslations } from "next-intl";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";
import { GlobalLoadingOverlay } from "@/components/ui/global-loading-overlay";
import { usePipelineContext } from "@/hooks/usePipelineContext";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const tCommon = useTranslations("common");
  // Resuelto una sola vez aquí y pasado hacia abajo — Sidebar (indicador de paso incompleto) lo
  // necesita, y llamar al hook por cuenta propia duplicaría el fetch de /datasets +
  // /models-with-roles en cada carga de página.
  const pipelineContext = usePipelineContext();

  return (
    // A05-R8: el bloque `@media (prefers-reduced-motion)` de globals.css solo apaga transiciones
    // CSS — Framer Motion anima vía JS/transform, fuera de su alcance. `MotionConfig` es el
    // interruptor real para toda animación de Framer Motion en el árbol (Sidebar, Modal, overlays).
    <MotionConfig reducedMotion="user">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white focus:dark:text-plane"
      >
        {tCommon("skipToContent")}
      </a>
      <div className="flex min-h-screen bg-plane">
        <Sidebar
          mobileOpen={mobileNavOpen}
          onMobileClose={() => setMobileNavOpen(false)}
          pipelineContext={pipelineContext}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar onMenuClick={() => setMobileNavOpen(true)} />
          <main id="main-content" className="mx-auto w-full max-w-[1600px] flex-1 space-y-6 px-6 py-6">
            {children}
          </main>
        </div>
        <GlobalLoadingOverlay />
      </div>
    </MotionConfig>
  );
}
