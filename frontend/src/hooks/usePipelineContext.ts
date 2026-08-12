"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useGlobalStore } from "@/lib/store";

type DatasetLite = { id: string; display_name: string; time_variable: string | null };
type ModelLite = { id: string; name: string; role: "hero" | "challenger1" | "challenger2" | null };

export type PipelineContext = {
  datasetName: string | null;
  modelName: string | null;
  hasDataset: boolean;
  hasTimeVariable: boolean;
  hasHeroModel: boolean;
};

const EMPTY: PipelineContext = {
  datasetName: null,
  modelName: null,
  hasDataset: false,
  hasTimeVariable: false,
  hasHeroModel: false,
};

// Fuente única para la barra de contexto (dataset/modelo activos) y los indicadores de paso
// incompleto del Sidebar — hoy 4 módulos resuelven "¿cuál es el dataset activo?" por su cuenta.
// `lib/store.ts` solo persiste ids; esto resuelve nombre + señales de completitud a partir de
// endpoints que ya existen (GET /datasets, GET /datasets/{id}/models-with-roles).
export function usePipelineContext(): PipelineContext {
  const datasetId = useGlobalStore((s) => s.datasetId);
  const modelId = useGlobalStore((s) => s.modelId);
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
        const model = models.find((m) => m.id === modelId);
        const hero = models.find((m) => m.role === "hero");
        setCtx({
          datasetName: dataset?.display_name ?? null,
          modelName: model?.name ?? hero?.name ?? null,
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
  }, [datasetId, modelId, activeCompanyId]);

  return ctx;
}
