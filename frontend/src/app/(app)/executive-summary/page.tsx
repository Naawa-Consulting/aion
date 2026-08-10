"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Card, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Eyebrow } from "@/components/ui/eyebrow";
import PlannerView from "@/components/predict/PlannerView";
import { apiFetch } from "@/lib/api";
import { formatChartNumber } from "@/lib/chart-format";
import { useGlobalStore } from "@/lib/store";

type Dataset = { id: string; display_name: string };
type Model = { id: string; name: string; role: string | null; r2: number | null; adj_r2: number | null };
type GroupContribution = { group_id: string | null; group_name: string | null; contribution: number; percent: number };
type Summary = {
  model: { id: string; name: string; y_var: string };
  total_contribution: number;
  groups: GroupContribution[];
};
type EconomicsTotals = {
  investment: number;
  revenue: number;
  contribution: number;
  roi: number | null;
  roas: number | null;
};
type EconomicsSummary = { economics_configured: boolean; totals: EconomicsTotals };

const roiLabel = (value: number | null | undefined) =>
  value === null || value === undefined || !Number.isFinite(value) ? "-" : `${(value * 100).toFixed(1)}%`;
const roasLabel = (value: number | null | undefined) =>
  value === null || value === undefined || !Number.isFinite(value) ? "-" : `${value.toFixed(2)}x`;

export default function ExecutiveSummaryPage() {
  const { activeCompanyId } = useGlobalStore();
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedDataset, setSelectedDataset] = useState("");
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [economics, setEconomics] = useState<EconomicsSummary | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchDatasets = useCallback(async () => {
    try {
      const data = await apiFetch<Dataset[]>("/datasets");
      setDatasets(data);
      if (data.length) setSelectedDataset((prev) => prev || data[0].id);
    } catch {
      toast.error("Failed to load datasets");
    }
  }, []);

  const fetchModels = useCallback(async (datasetId: string) => {
    try {
      const data = await apiFetch<any[]>(`/datasets/${datasetId}/models-with-roles`);
      const normalized: Model[] = data.map((m: any) => ({
        id: m.id,
        name: m.name,
        role: !m.role || m.role === "none" ? null : m.role,
        r2: m.r2 ?? null,
        adj_r2: m.adj_r2 ?? null,
      }));
      setModels(normalized);
      const hero = normalized.find((m) => m.role === "hero");
      setSelectedModel(hero ? hero.id : normalized[0]?.id ?? "");
    } catch {
      toast.error("Failed to load models");
      setModels([]);
      setSelectedModel("");
    }
  }, []);

  const fetchKpis = useCallback(async (modelId: string) => {
    setLoading(true);
    try {
      const [summaryData, economicsData] = await Promise.all([
        apiFetch<Summary>(`/analysis/${modelId}/summary`),
        apiFetch<EconomicsSummary>(`/economics/${modelId}/summary`),
      ]);
      setSummary(summaryData);
      setEconomics(economicsData);
    } catch {
      toast.error("Failed to load KPIs");
      setSummary(null);
      setEconomics(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!activeCompanyId) return;
    fetchDatasets();
  }, [fetchDatasets, activeCompanyId]);

  useEffect(() => {
    if (selectedDataset) fetchModels(selectedDataset);
  }, [selectedDataset, fetchModels]);

  useEffect(() => {
    if (selectedModel) fetchKpis(selectedModel);
    else {
      setSummary(null);
      setEconomics(null);
    }
  }, [selectedModel, fetchKpis]);

  const selectedModelInfo = models.find((m) => m.id === selectedModel);
  const topGroups = (summary?.groups ?? [])
    .filter((g) => g.group_id !== "baseline" && g.group_name?.toLowerCase() !== "baseline")
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, 3);

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm text-[var(--color-muted)]">Vista ejecutiva</p>
          <h1 className="text-2xl font-semibold">Resumen Ejecutivo</h1>
        </div>
        <div className="flex flex-wrap gap-3 items-center">
          <label className="flex flex-col">
            <Eyebrow>Dataset</Eyebrow>
            <Select wrapperClassName="mt-1" value={selectedDataset} onChange={(e) => setSelectedDataset(e.target.value)}>
              {datasets.map((ds) => (
                <option key={ds.id} value={ds.id}>
                  {ds.display_name}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col">
            <Eyebrow>Model</Eyebrow>
            <Select wrapperClassName="mt-1" value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)}>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.role === "hero" ? " (hero)" : ""}
                </option>
              ))}
            </Select>
          </label>
        </div>
      </header>

      {!selectedModel ? (
        <Card>
          <p className="text-sm text-[var(--color-muted)]">Selecciona un dataset y un modelo para ver el resumen.</p>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <Card padding="sm">
              <CardHeader title="Fit del modelo" subtitle="R² / R² ajustado" />
              <p className="text-lg font-semibold">
                {selectedModelInfo?.r2 !== null && selectedModelInfo?.r2 !== undefined
                  ? `${formatChartNumber(selectedModelInfo.r2 * 100, 1)}%`
                  : "-"}
                {selectedModelInfo?.adj_r2 !== null && selectedModelInfo?.adj_r2 !== undefined && (
                  <span className="text-xs text-[var(--color-muted)]"> ({formatChartNumber(selectedModelInfo.adj_r2 * 100, 1)}% adj.)</span>
                )}
              </p>
            </Card>
            <Card padding="sm">
              <CardHeader title="Contribución total" subtitle={summary?.model?.y_var} />
              <p className="text-lg font-semibold">
                {summary ? formatChartNumber(summary.total_contribution, 1) : "-"}
              </p>
            </Card>
            <Card padding="sm">
              <CardHeader title="ROI" subtitle="(ingreso - inversión) / inversión" />
              <p className="text-lg font-semibold">{roiLabel(economics?.totals.roi)}</p>
            </Card>
            <Card padding="sm">
              <CardHeader title="ROAS" subtitle="ingreso / inversión" />
              <p className="text-lg font-semibold">{roasLabel(economics?.totals.roas)}</p>
            </Card>
          </div>

          <Card className="space-y-3">
            <CardHeader title="Top grupos por contribución" />
            {topGroups.length ? (
              <div className="grid gap-3 sm:grid-cols-3">
                {topGroups.map((group, index) => (
                  <div key={group.group_id ?? group.group_name ?? index} className="space-y-1">
                    <Eyebrow>{group.group_name || "Grupo"}</Eyebrow>
                    <p className="text-base font-semibold">{formatChartNumber(group.contribution, 1)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--color-muted)]">
                {loading ? "Cargando..." : "Sin datos de contribución todavía."}
              </p>
            )}
          </Card>

          <Card className="space-y-4">
            <CardHeader
              title="Presupuesto inverso"
              subtitle="Escribe un presupuesto disponible y obtén la asignación sugerida por canal"
            />
            <PlannerView modelId={selectedModel} />
          </Card>
        </>
      )}
    </section>
  );
}
