"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useGlobalStore } from "@/lib/store";

type DatasetLite = { id: string; display_name: string; time_variable: string | null };
type ModelLite = { id: string; name: string; role: "hero" | "challenger1" | "challenger2" | null };
type VariableLite = { id: string; group_id: string | null };
type EconomicsSummaryLite = { economics_configured: boolean; channels: unknown[] };
type ScenarioLite = { id: string };

export type PipelineContext = {
  hasDataset: boolean;
  hasTimeVariable: boolean;
  hasHeroModel: boolean;
  hasCategorizedVariable: boolean;
  economicsIncomplete: boolean;
  hasScenario: boolean;
};

const EMPTY: PipelineContext = {
  hasDataset: false,
  hasTimeVariable: false,
  hasHeroModel: false,
  hasCategorizedVariable: false,
  economicsIncomplete: false,
  hasScenario: false,
};

// Fuente única para los indicadores de paso incompleto del Sidebar — resuelve las señales de
// completitud a partir de endpoints que ya existen (GET /datasets, GET
// /datasets/{id}/models-with-roles, GET /variables, GET /economics/{id}/summary, GET
// /predict/scenarios) en vez de que cada página las derive por su cuenta. Las últimas 3 solo se
// piden cuando hay un hero model (economía/escenarios no tienen sentido sin uno).
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
      apiFetch<VariableLite[]>(`/variables?dataset_id=${datasetId}`),
    ])
      .then(async ([datasets, models, variables]) => {
        if (cancelled) return;
        const dataset = datasets.find((d) => d.id === datasetId);
        const hero = models.find((m) => m.role === "hero");
        const hasCategorizedVariable = variables.some((v) => !!v.group_id);

        let economicsIncomplete = false;
        let hasScenario = false;
        if (hero) {
          const [economics, scenarios] = await Promise.all([
            apiFetch<EconomicsSummaryLite>(`/economics/${hero.id}/summary`).catch(() => null),
            apiFetch<ScenarioLite[]>(`/predict/scenarios?model_id=${hero.id}`).catch(() => []),
          ]);
          economicsIncomplete = !!economics && economics.channels.length > 0 && !economics.economics_configured;
          hasScenario = scenarios.length > 0;
        }

        if (cancelled) return;
        setCtx({
          hasDataset: !!dataset,
          hasTimeVariable: !!dataset?.time_variable,
          hasHeroModel: !!hero,
          hasCategorizedVariable,
          economicsIncomplete,
          hasScenario,
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
