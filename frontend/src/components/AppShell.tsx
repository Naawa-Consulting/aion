"use client";

import React, { useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";
import { GlobalLoadingOverlay } from "@/components/ui/global-loading-overlay";
import { usePipelineContext } from "@/hooks/usePipelineContext";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Resuelto una sola vez aquí y pasado hacia abajo — Sidebar (indicador de paso incompleto) lo
  // necesita, y llamar al hook por cuenta propia duplicaría el fetch de /datasets +
  // /models-with-roles en cada carga de página.
  const pipelineContext = usePipelineContext();

  return (
    <div className="flex min-h-screen bg-plane">
      <Sidebar
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
        pipelineContext={pipelineContext}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onMenuClick={() => setMobileNavOpen(true)} />
        <main className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-6 py-6">{children}</main>
      </div>
      <GlobalLoadingOverlay />
    </div>
  );
}
