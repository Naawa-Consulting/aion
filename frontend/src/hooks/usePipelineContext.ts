"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useGlobalStore } from "@/lib/store";

type DatasetLite = { id: string; display_name: string; time_variable: string | null };
type ModelLite = { id: string; name: string; role: "hero" | "challenger1" | "challenger2" | null };

export type PipelineContext = {
  hasDataset: boolean;
  hasTimeVariable: boolean;
  hasHeroModel: boolean;
};

const EMPTY: PipelineContext = {
  hasDataset: false,
  hasTimeVariable: false,
  hasHeroModel: false,
};

// Fuente única para los indicadores de paso incompleto del Sidebar — resuelve las señales de
// completitud a partir de endpoints que ya existen (GET /datasets, GET
// /datasets/{id}/models-with-roles) en vez de que cada página las derive por su cuenta.
export function usePipelineContext(): PipelineContext {
  const datasetId = useGlobalStore((s) => s.datasetId);
  const activeCompanyId = useGlobalStore((s) => s.activeCompanyId);
  const [ctx, setCtx] = useState<PipelineContext>(EMPTY);

  useEffect(() => {
    if (!datasetId || !activeCompanyId) {
      setCtx(EMPTY);
      return;
    }
    let cancelled = false;
    Promise.all([
      apiFetch<DatasetLite[]>("/datasets"),
      apiFetch<ModelLite[]>(`/datasets/${datasetId}/models-with-roles`),
    ])
      .then(([datasets, models]) => {
        if (cancelled) return;
        const dataset = datasets.find((d) => d.id === datasetId);
        const hero = models.find((m) => m.role === "hero");
        setCtx({
          hasDataset: !!dataset,
          hasTimeVariable: !!dataset?.time_variable,
          hasHeroModel: !!hero,
        });
      })
      .catch(() => {
        if (!cancelled) setCtx(EMPTY);
      });
    return () => {
      cancelled = true;
    };
  }, [datasetId, activeCompanyId]);

  return ctx;
}
