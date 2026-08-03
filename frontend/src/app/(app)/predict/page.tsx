"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from "recharts";
import { toast } from "sonner";

import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import ScenarioSheetGlide, { type MultipliersMap } from "@/components/predict/ScenarioSheetGlide";
import { apiFetch, ApiError } from "@/lib/api";
import { useCanEdit } from "@/hooks/useCanEdit";

type Dataset = { id: string; display_name: string; columns: { name: string; dtype: string }[] };
type Model = {
  id: string;
  name: string;
  dataset_id: string;
  role?: string;
  is_hero: boolean;
  y_var?: string;
};

type VariableRow = {
  name: string;
  baseline_mean: number;
  group_name?: string | null;
  subgroup_name?: string | null;
};

type PeriodValue = {
  mode: "multiplier" | "value";
  value: number;
};

type ContributionSlice = { id?: string | null; name?: string | null; value: number };
type ScenarioSeriesPoint = { period: string; y_pred: number };

type ScenarioSummary = {
  periods: string[];
  total: number;
  average_per_period: number;
  groups: ContributionSlice[];
  subgroups: ContributionSlice[];
  series: ScenarioSeriesPoint[];
};

type Scenario = {
  id: string;
  model_id: string;
  dataset_id?: string | null;
  name: string;
  horizon: number;
  start_date: string;
  freq: "day" | "week" | "month";
  adjustments: Record<string, Record<string, PeriodValue>>;
  summary: ScenarioSummary;
  last_edited_at: string;
  base_total?: number | null;
  delta_pct_vs_base?: number | null;
};

const DEFAULT_MULTIPLIER = 1;

export default function PredictPage() {
  const canEdit = useCanEdit();
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedDataset, setSelectedDataset] = useState("");
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState("");

  const [variables, setVariables] = useState<VariableRow[]>([]);
  const [adjustments, setAdjustments] = useState<Record<string, Record<string, PeriodValue>>>({});

  const [horizon, setHorizon] = useState(12);
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [freq, setFreq] = useState<"day" | "week" | "month">("month");

  const [preview, setPreview] = useState<ScenarioSummary | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [scenarioName, setScenarioName] = useState("Scenario 1");
  const [currentScenarioId, setCurrentScenarioId] = useState<string | null>(null);
  const [renamingScenarioId, setRenamingScenarioId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [heroSeries, setHeroSeries] = useState<ScenarioSeriesPoint[]>([]);
  const [heroLoading, setHeroLoading] = useState(false);
  const [showProjectedTable, setShowProjectedTable] = useState(false);
  const [assumptionsExporting, setAssumptionsExporting] = useState(false);
  const [totalsExporting, setTotalsExporting] = useState(false);

  const numberFormatter = useMemo(
    () => new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    []
  );
  const percentFormatter = useMemo(
    () => new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    []
  );
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }), []);
  const formatScenarioDate = useCallback(
    (value: string | null | undefined) => {
      if (!value) return "-";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "-";
      return dateFormatter.format(date);
    },
    [dateFormatter]
  );

  const periodLabels = useMemo(() => buildPeriodLabels(startDate, horizon, freq), [startDate, horizon, freq]);
  const displayPeriods = preview?.periods?.length ? preview.periods : periodLabels;
  const editablePeriods = displayPeriods.length ? displayPeriods : periodLabels;
  const gridVariables = useMemo(
    () =>
      variables.map((variable) => ({
        name: variable.name,
        baselineMean: variable.baseline_mean,
        group: variable.group_name ?? "Other",
      })),
    [variables]
  );
  const multipliersByVariable = useMemo(
    () => buildMultipliersFromAdjustments(variables, editablePeriods, adjustments),
    [variables, editablePeriods, adjustments]
  );
  const absoluteValuesByVariable = useMemo(
    () => buildAbsoluteValuesFromAdjustments(variables, editablePeriods, adjustments),
    [variables, editablePeriods, adjustments]
  );
  const selectedModelInfo = useMemo(
    () => models.find((model) => model.id === selectedModel),
    [models, selectedModel]
  );
  const dependentLabel = selectedModelInfo?.y_var ?? "Y";
  const freqLabel = freq === "day" ? "day" : freq === "week" ? "week" : "month";
  const editMode: "absolute" = "absolute";
  const SCENARIO_LIMIT = 5;
  const reachedScenarioLimit = !currentScenarioId && scenarios.length >= SCENARIO_LIMIT;
  const saveButtonLabel = currentScenarioId ? "Save changes" : "Save scenario";

  const fetchDatasets = useCallback(async () => {
    try {
      const data = await apiFetch<Dataset[]>("/datasets");
      setDatasets(data);
      if (data.length) {
        setSelectedDataset((prev) => (prev ? prev : data[0].id));
      }
    } catch {
      toast.error("Failed to load datasets");
    }
  }, []);

  const fetchModels = useCallback(async (datasetId: string) => {
    try {
      const data = await apiFetch<any[]>(`/models?dataset_id=${datasetId}`);
      const normalized: Model[] = data.map((m: any) => ({
        id: m.id,
        name: m.name,
        dataset_id: m.dataset_id,
        role: m.role,
        is_hero: Boolean(m.is_hero),
        y_var: m.y_var,
      }));
      setModels(normalized);
      const hero = normalized.find((m) => m.role === "hero" || m.is_hero) || normalized[0];
      if (hero) setSelectedModel(hero.id);
    } catch {
      toast.error("Failed to load models");
    }
  }, []);

  const requestScenarioSummary = useCallback(
    async (customAdjustments: Record<string, Record<string, PeriodValue>>) => {
      if (!selectedModel) {
        throw new Error("Select a model first");
      }
      const payload = {
        model_id: selectedModel,
        horizon,
        start_date: startDate,
        freq,
        adjustments: customAdjustments,
      };
      const data = await apiFetch<ScenarioSummary>("/predict/scenarios/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      return data;
    },
    [selectedModel, horizon, startDate, freq]
  );

  const fetchPreview = useCallback(async () => {
    if (!selectedModel) return;
    setPreviewLoading(true);
    try {
      const data = await requestScenarioSummary(adjustments);
      setPreview(data);
    } catch (error: any) {
      toast.error(error?.message || "Preview failed");
    } finally {
      setPreviewLoading(false);
    }
  }, [selectedModel, adjustments, requestScenarioSummary]);

  const fetchBaselineVariables = useCallback(async (modelId: string) => {
    try {
      const data = await apiFetch<any>(`/predict/${modelId}/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adjustments: [] }),
      });
      setVariables(data.variables || []);
      fetchPreview();
    } catch {
      toast.error("Failed to load baseline variables");
    }
  }, [fetchPreview]);

  const fetchScenarios = useCallback(async (modelId: string) => {
    try {
      const data = await apiFetch<Scenario[]>(`/predict/scenarios?model_id=${modelId}`);
      setScenarios(data);
    } catch {
      toast.error("Failed to load scenarios");
    }
  }, []);

  useEffect(() => {
    fetchDatasets();
  }, [fetchDatasets]);

  useEffect(() => {
    if (selectedDataset) {
      fetchModels(selectedDataset);
    }
  }, [selectedDataset, fetchModels]);

  useEffect(() => {
    setCurrentScenarioId(null);
    setRenamingScenarioId(null);
    setRenameValue("");
    setScenarioName("Scenario 1");
  }, [selectedModel]);

  useEffect(() => {
    if (!selectedModel) return;
    fetchBaselineVariables(selectedModel);
    fetchScenarios(selectedModel);
  }, [selectedModel, fetchBaselineVariables, fetchScenarios]);

  useEffect(() => {
    if (currentScenarioId && !scenarios.some((scenario) => scenario.id === currentScenarioId)) {
      setCurrentScenarioId(null);
    }
  }, [scenarios, currentScenarioId]);

  useEffect(() => {
    ensureAdjustmentDefaults(periodLabels, variables, setAdjustments);
  }, [periodLabels, variables]);

  useEffect(() => {
    if (!selectedModel || !variables.length || !editablePeriods.length) {
      setHeroSeries([]);
      return;
    }
    const baselineAdjustments = buildBaselineAdjustments(editablePeriods, variables);
    setHeroLoading(true);
    requestScenarioSummary(baselineAdjustments)
      .then((data) => setHeroSeries(data.series || []))
      .catch(() => setHeroSeries([]))
      .finally(() => setHeroLoading(false));
  }, [selectedModel, editablePeriods, variables, requestScenarioSummary]);

  const handleGridMultipliersChange = useCallback(
    (nextMultipliers: MultipliersMap, absoluteOverrides?: Record<string, Record<string, number>>) => {
      setAdjustments(
        multipliersToAdjustments(nextMultipliers, editablePeriods, variables, absoluteOverrides)
      );
    },
    [editablePeriods, variables]
  );
  const handleResetAll = useCallback(() => {
    if (!window.confirm("Reset to base scenario? This will overwrite all current adjustments.")) return;
    setAdjustments((prev) => {
      const next: Record<string, Record<string, PeriodValue>> = {};
      editablePeriods.forEach((period) => {
        const mapping: Record<string, PeriodValue> = {};
        variables.forEach((variable) => {
          mapping[variable.name] = { mode: "multiplier", value: 1 };
        });
        next[period] = mapping;
      });
      return next;
    });
    setCurrentScenarioId(null);
    setRenamingScenarioId(null);
    setRenameValue("");
  }, [editablePeriods, variables]);

  const handleSaveScenario = async () => {
    if (!selectedModel) {
      toast.error("Select a model first");
      return;
    }
    if (!currentScenarioId && scenarios.length >= SCENARIO_LIMIT) {
      toast.error(`Maximum ${SCENARIO_LIMIT} saved scenarios. Delete one to save a new scenario.`);
      return;
    }
    setSaving(true);
    try {
      const payload = {
        model_id: selectedModel,
        name: scenarioName || "Scenario",
        horizon,
        start_date: startDate,
        freq,
        adjustments,
      };
      const path = currentScenarioId
        ? `/predict/scenarios/${currentScenarioId}`
        : `/predict/scenarios`;
      const method = currentScenarioId ? "PATCH" : "POST";
      const data = await apiFetch<Scenario>(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setScenarioName(data.name);
      setHorizon(data.horizon);
      setStartDate(data.start_date);
      setFreq(data.freq);
      setAdjustments(cloneAdjustments(data.adjustments));
      setPreview(data.summary);
      setCurrentScenarioId(data.id);
      setRenamingScenarioId(null);
      setRenameValue("");
      toast.success(currentScenarioId ? "Scenario updated" : "Scenario saved");
      await fetchScenarios(selectedModel);
    } catch (error: any) {
      toast.error(error?.message || "Unable to save scenario");
    } finally {
      setSaving(false);
    }
  };

  const handleLoadScenario = (scenario: Scenario) => {
    setScenarioName(scenario.name);
    setHorizon(scenario.horizon);
    setStartDate(scenario.start_date);
    setFreq(scenario.freq);
    setAdjustments(cloneAdjustments(scenario.adjustments));
    setCurrentScenarioId(scenario.id);
    setRenamingScenarioId(null);
    setRenameValue("");
    setPreview(scenario.summary);
  };

  const handleDeleteScenario = async (scenarioId: string) => {
    if (!window.confirm("Delete this scenario? This cannot be undone.")) return;
    try {
      await apiFetch<void>(`/predict/scenarios/${scenarioId}`, { method: "DELETE" });
      toast.success("Scenario deleted");
      if (currentScenarioId === scenarioId) {
        setCurrentScenarioId(null);
      }
      if (renamingScenarioId === scenarioId) {
        setRenamingScenarioId(null);
        setRenameValue("");
      }
      if (selectedModel) fetchScenarios(selectedModel);
    } catch (error: any) {
      toast.error(error?.message || "Unable to delete scenario");
    }
  };

  const cancelRename = useCallback(() => {
    setRenamingScenarioId(null);
    setRenameValue("");
  }, []);

  const handleStartRename = (scenario: Scenario) => {
    setRenamingScenarioId(scenario.id);
    setRenameValue(scenario.name);
  };

  const submitRename = useCallback(
    async (scenarioId: string, newName: string) => {
      if (!selectedModel) return;
      const trimmed = newName.trim();
      if (!trimmed) {
        cancelRename();
        return;
      }
      try {
        await apiFetch<Scenario>(`/predict/scenarios/${scenarioId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmed }),
        });
        toast.success("Scenario renamed");
        if (currentScenarioId === scenarioId) {
          setScenarioName(trimmed);
        }
        await fetchScenarios(selectedModel);
      } catch (error: any) {
        toast.error(error?.message || "Unable to rename scenario");
      } finally {
        cancelRename();
      }
    },
    [selectedModel, currentScenarioId, fetchScenarios, cancelRename]
  );

  const handleRenameBlur = (scenario: Scenario) => {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === scenario.name) {
      cancelRename();
      return;
    }
    submitRename(scenario.id, trimmed);
  };

  const handleRenameKeyDown = (event: React.KeyboardEvent<HTMLInputElement>, scenario: Scenario) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleRenameBlur(scenario);
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelRename();
    }
  };

  const scenarioSeries = useMemo(() => preview?.series ?? [], [preview]);
  const groups = useMemo(() => preview?.groups ?? [], [preview]);
  const projectedTotal = preview?.total ?? null;
  const baselineEntry = groups.find(
    (group) => group.id === "baseline" || group.name?.toLowerCase() === "baseline"
  );
  const otherEntry = groups.find(
    (group) => !group.id && (!group.name || group.name.toLowerCase() === "other")
  );
  const baselineContribution = baselineEntry?.value ?? null;
  const otherContribution = otherEntry?.value ?? null;
  const dynamicGroupSlices = useMemo(
    () =>
      groups
        .filter((group) => {
          const normalized = group.name?.toLowerCase() ?? "";
          if (group.id === "baseline" || normalized === "baseline") return false;
          if (!group.id && (!group.name || normalized === "other")) return false;
          return true;
        })
        .sort((a, b) => Math.abs(b.value) - Math.abs(a.value)),
    [groups]
  );
  const shareOfTotal = useCallback(
    (value: number | null | undefined) => {
      if (!projectedTotal || projectedTotal === 0 || value === null || value === undefined) return null;
      return (value / projectedTotal) * 100;
    },
    [projectedTotal]
  );
  const formatShareLabel = useCallback(
    (value: number | null | undefined) => {
      const share = shareOfTotal(value);
      return share !== null ? `${percentFormatter.format(share)}% of total` : undefined;
    },
    [shareOfTotal, percentFormatter]
  );
  const contributionCards = useMemo(() => {
    const items: { key: string; title: string; value: number | null | undefined; subtitle?: string }[] = [
      {
        key: "projected-total",
        title: "Projected total",
        value: preview?.total ?? null,
        subtitle: `Forecast: ${dependentLabel}`,
      },
      {
        key: "average-period",
        title: "Average per period",
        value: preview?.average_per_period ?? null,
        subtitle: freqLabel,
      },
    ];
    if (baselineEntry) {
      items.push({
        key: "baseline",
        title: "Baseline",
        value: baselineContribution,
        subtitle: formatShareLabel(baselineContribution),
      });
    }
    dynamicGroupSlices.forEach((slice, index) => {
      items.push({
        key: `group-${slice.id ?? slice.name ?? index}`,
        title: slice.name || "Group",
        value: slice.value,
        subtitle: formatShareLabel(slice.value),
      });
    });
    if (otherEntry && otherEntry.value !== undefined && otherEntry.value !== null && Math.abs(otherEntry.value) > 1e-9) {
      items.push({
        key: "other",
        title: otherEntry.name || "Other",
        value: otherContribution,
        subtitle: formatShareLabel(otherContribution),
      });
    }
    return items;
  }, [
    preview,
    dependentLabel,
    freqLabel,
    baselineEntry,
    baselineContribution,
    dynamicGroupSlices,
    otherEntry,
    otherContribution,
    formatShareLabel,
  ]);
  const chartData = useMemo(() => {
    const map = new Map<string, { hero?: number | null; scenario?: number | null }>();
    scenarioSeries.forEach((point) => {
      const entry = map.get(point.period) || {};
      entry.scenario = point.y_pred;
      map.set(point.period, entry);
    });
    heroSeries.forEach((point) => {
      const entry = map.get(point.period) || {};
      entry.hero = point.y_pred;
      map.set(point.period, entry);
    });
    const ordered = displayPeriods.length ? displayPeriods : Array.from(map.keys());
    return ordered.map((period) => {
      const entry = map.get(period) || {};
      return {
        period,
        hero: entry.hero ?? null,
        scenario: entry.scenario ?? null,
      };
    });
  }, [scenarioSeries, heroSeries, displayPeriods]);
  const hasChartData = chartData.some((row) => row.hero !== null || row.scenario !== null);
  const renderTimeseriesTooltip = useCallback(
    ({ active, payload, label }: any) => {
      if (!active || !payload?.length) return null;
      return (
        <div className="rounded-md border bg-white px-3 py-2 text-xs shadow">
          <p className="font-semibold">{label}</p>
          {payload.map((item: any) => (
            <p key={item.dataKey} className="flex items-center justify-between gap-4 capitalize text-[var(--color-muted)]">
              <span>{item.name}</span>
              <span className="font-semibold text-[var(--color-foreground)]">
                {formatNumber(numberFormatter, typeof item.value === "number" ? item.value : Number(item.value))}
              </span>
            </p>
          ))}
        </div>
      );
    },
    [numberFormatter]
  );
  const handleExportAssumptions = useCallback(async () => {
    if (!selectedModel) {
      toast.error("Select a model first");
      return;
    }
    if (!variables.length || !editablePeriods.length) {
      toast.error("Nothing to export yet");
      return;
    }
    setAssumptionsExporting(true);
    try {
      const payload = {
        model_id: selectedModel,
        horizon,
        start_date: startDate,
        freq,
        adjustments,
        mode: editMode,
        scenario_name: scenarioName || dependentLabel,
      };
      const blob = await apiFetch<Blob>("/predict/scenarios/assumptions/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        responseType: "blob",
      });
      const filename = buildExportFilename(scenarioName || dependentLabel || "scenario", "assumptions");
      downloadBlob(blob, filename);
    } catch (error) {
      const message = error instanceof ApiError ? (error.detail?.detail || error.detail?.error) : null;
      toast.error(message || (error as Error)?.message || "Failed to export assumptions");
    } finally {
      setAssumptionsExporting(false);
    }
  }, [
    selectedModel,
    variables.length,
    editablePeriods.length,
    horizon,
    startDate,
    freq,
    adjustments,
    editMode,
    scenarioName,
    dependentLabel,
  ]);
  const handleExportTimeseries = useCallback(async () => {
    if (!selectedModel || !chartData.length) {
      toast.error("Preview the scenario before exporting");
      return;
    }
    setTotalsExporting(true);
    try {
      const payload = {
        model_id: selectedModel,
        horizon,
        start_date: startDate,
        freq,
        adjustments,
        scenario_name: scenarioName || dependentLabel,
        include_hero: true,
      };
      const blob = await apiFetch<Blob>("/predict/scenarios/projected/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        responseType: "blob",
      });
      const filename = buildExportFilename(scenarioName || dependentLabel || "scenario", "projected");
      downloadBlob(blob, filename);
    } catch (error) {
      const message = error instanceof ApiError ? (error.detail?.detail || error.detail?.error) : null;
      toast.error(message || (error as Error)?.message || "Failed to export totals");
    } finally {
      setTotalsExporting(false);
    }
  }, [
    selectedModel,
    chartData.length,
    horizon,
    startDate,
    freq,
    adjustments,
    scenarioName,
    dependentLabel,
  ]);

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm text-[var(--color-muted)]">Module 5</p>
          <h1 className="text-2xl font-semibold">Predict & Scenario Simulation</h1>
        </div>
        <div className="flex flex-wrap gap-3 items-center">
          <label className="flex flex-col text-xs uppercase text-[var(--color-muted)]">
            Dataset
            <select
              className="mt-1 rounded-full border border-[var(--color-border)] px-4 py-2 bg-transparent"
              value={selectedDataset}
              onChange={(e) => setSelectedDataset(e.target.value)}
            >
              {datasets.map((ds) => (
                <option key={ds.id} value={ds.id}>
                  {ds.display_name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col text-xs uppercase text-[var(--color-muted)]">
            Model
            <select
              className="mt-1 rounded-full border border-[var(--color-border)] px-4 py-2 bg-transparent"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <Card className="space-y-4">
        <CardHeader title="Scenario parameters" subtitle="Planner horizon and frequency" />
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex flex-col gap-2">
            Horizon
            <input
              type="number"
              min={1}
              className="rounded-lg border border-[var(--color-border)] px-3 py-2 bg-transparent"
              value={horizon}
              onChange={(e) => setHorizon(Math.max(1, Number(e.target.value) || 1))}
            />
          </label>
          <label className="flex flex-col gap-2">
            Start date
            <input
              type="date"
              className="rounded-lg border border-[var(--color-border)] px-3 py-2 bg-transparent"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-2">
            Frequency
            <select
              className="rounded-lg border border-[var(--color-border)] px-3 py-2 bg-transparent"
              value={freq}
              onChange={(e) => setFreq(e.target.value as any)}
            >
              <option value="day">Daily</option>
              <option value="week">Weekly</option>
              <option value="month">Monthly</option>
            </select>
          </label>
          <label className="flex flex-col gap-2 flex-1 min-w-[200px]">
            Scenario name
            <input
              type="text"
              className="rounded-lg border border-[var(--color-border)] px-3 py-2 bg-transparent"
              value={scenarioName}
              onChange={(e) => setScenarioName(e.target.value)}
            />
          </label>
        </div>
        <div className="flex gap-3 flex-wrap">
          <Button onClick={fetchPreview} disabled={previewLoading || !selectedModel}>
            {previewLoading ? "Recalculating..." : "Preview scenario"}
          </Button>
          <Button
            variant="secondary"
            onClick={handleSaveScenario}
            disabled={!canEdit || saving || !selectedModel || reachedScenarioLimit}
            title={!canEdit ? "Solo lectura: tu rol es Visualizador" : undefined}
          >
            {saving ? "Saving..." : saveButtonLabel}
          </Button>
        </div>
        {reachedScenarioLimit && (
          <p className="text-xs text-red-500">
            Maximum of {SCENARIO_LIMIT} saved scenarios reached. Delete one to save a new scenario.
          </p>
        )}
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {contributionCards.map((card) => (
          <Card key={card.key} padding="sm">
            <CardHeader title={card.title} subtitle={card.subtitle} />
            <p className="text-lg font-semibold">
              {card.value !== null && card.value !== undefined
                ? formatNumber(numberFormatter, card.value)
                : "-"}
            </p>
          </Card>
        ))}
      </div>

      <Card className="space-y-4">
        <CardHeader title="Scenario builder" subtitle="Edit absolute values by period and variable" />
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
            Mode: Absolute values
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" onClick={handleResetAll}>
              Reset to base scenario
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleExportAssumptions}
              disabled={assumptionsExporting || !variables.length}
            >
              {assumptionsExporting ? "Exporting..." : "Export Excel"}
            </Button>
          </div>
        </div>
        {variables.length ? (
          <ScenarioSheetGlide
            variables={gridVariables}
            periods={editablePeriods}
            multipliers={multipliersByVariable}
            absoluteValues={absoluteValuesByVariable}
            editMode={editMode}
            onMultipliersChange={handleGridMultipliersChange}
          />
        ) : (
          <p className="text-sm text-[var(--color-muted)]">Select a model to load variables.</p>
        )}
      </Card>

      <Card className="space-y-4">
        <CardHeader title="Projected totals" subtitle="Base Scenario vs Scenario" />
        {hasChartData ? (
          <>
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.4)" />
                  <XAxis dataKey="period" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={(value) => formatNumber(numberFormatter, Number(value))} />
                  <RechartsTooltip content={renderTimeseriesTooltip} />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="hero"
                    name="Base Scenario"
                    stroke="var(--color-muted)"
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                  <Line
                    type="monotone"
                    dataKey="scenario"
                    name="Scenario"
                    stroke="var(--color-accent)"
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <label className="inline-flex items-center gap-2 text-xs text-[var(--color-muted)]">
                <input
                  type="checkbox"
                  className="rounded border border-[var(--color-border)]"
                  checked={showProjectedTable}
                  onChange={(event) => setShowProjectedTable(event.target.checked)}
                />
                Show table
              </label>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleExportTimeseries}
                disabled={!chartData.length || totalsExporting}
              >
                {totalsExporting ? "Exporting..." : "Export Excel"}
              </Button>
            </div>
            {showProjectedTable && (
              <div className="overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-[var(--color-bg)]/60">
                    <tr>
                      <th className="px-3 py-2 text-left">Period</th>
                      <th className="px-3 py-2 text-left">Base Scenario</th>
                      <th className="px-3 py-2 text-left">Scenario</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chartData.map((row) => (
                      <tr key={row.period} className="odd:bg-transparent even:bg-[var(--color-border)]/20">
                        <td className="px-3 py-2">{row.period}</td>
                        <td className="px-3 py-2">{row.hero !== null ? formatNumber(numberFormatter, row.hero) : "-"}</td>
                        <td className="px-3 py-2">{row.scenario !== null ? formatNumber(numberFormatter, row.scenario) : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-[var(--color-muted)]">
            {previewLoading || heroLoading ? "Loading projections..." : "Preview the scenario to see projections."}
          </p>
        )}
      </Card>

      <Card className="space-y-4">
        <CardHeader title="Saved scenarios" subtitle="Load, rename or delete (max 5)" />
        {scenarios.length ? (
          <div className="grid gap-4 md:grid-cols-3">
            {scenarios.map((scenario) => {
              const isActive = currentScenarioId === scenario.id;
              const isRenaming = renamingScenarioId === scenario.id;
              const freqLabelCard = scenario.freq === "day" ? "day" : scenario.freq === "week" ? "week" : "month";
              const delta = typeof scenario.delta_pct_vs_base === "number" ? scenario.delta_pct_vs_base : null;
              const deltaLabel =
                delta !== null ? `${delta > 0 ? "+" : delta < 0 ? "" : ""}${delta.toFixed(1)}% vs Base scenario` : null;
              const deltaClass =
                delta === null
                  ? ""
                  : delta > 0
                  ? "text-emerald-600"
                  : delta < 0
                  ? "text-red-500"
                  : "text-[var(--color-muted)]";
              return (
                <Card
                  key={scenario.id}
                  className={`space-y-3 border transition ${isActive ? "border-[var(--color-accent)] bg-[var(--color-accent)]/5" : ""}`}
                >
                  <div className="space-y-2 px-4 pt-4">
                    {isRenaming ? (
                      <input
                        type="text"
                        autoFocus
                        value={renameValue}
                        onChange={(event) => setRenameValue(event.target.value)}
                        onBlur={() => handleRenameBlur(scenario)}
                        onKeyDown={(event) => handleRenameKeyDown(event, scenario)}
                        className="w-full rounded-lg border border-[var(--color-border)] bg-transparent px-2 py-1 text-sm"
                      />
                    ) : (
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-semibold text-sm text-[var(--color-foreground)]">{scenario.name}</p>
                        <button
                          type="button"
                          className="text-xs text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
                          onClick={() => handleStartRename(scenario)}
                        >
                          Rename
                        </button>
                      </div>
                    )}
                    <div className="space-y-0.5">
                      <p className="text-xs uppercase tracking-wide text-[var(--color-muted)]">Projected total</p>
                      <p className="text-[1.35rem] font-semibold leading-tight text-[var(--color-foreground)] sm:text-[1.45rem]">
                        {formatNumber(numberFormatter, scenario.summary.total)}
                      </p>
                      {deltaLabel && (
                        <p className={`text-xs font-medium ${deltaClass}`}>
                          {deltaLabel}
                        </p>
                      )}
                    </div>
                    <p className="text-xs text-[var(--color-muted)]">
                      {scenario.horizon} periods - {freqLabelCard}
                    </p>
                    <p className="text-xs text-[var(--color-muted)]">
                      Last edited: {formatScenarioDate(scenario.last_edited_at)}
                    </p>
                  </div>
                  <div className="flex gap-2 px-4 pb-4">
                    <Button variant="secondary" onClick={() => handleLoadScenario(scenario)}>
                      Load
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => handleDeleteScenario(scenario.id)}
                      disabled={!canEdit}
                      title={!canEdit ? "Solo lectura: tu rol es Visualizador" : undefined}
                    >
                      Delete
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-[var(--color-muted)]">No saved scenarios yet.</p>
        )}
      </Card>
    </section>
  );
}

function formatNumber(formatter: Intl.NumberFormat, value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return formatter.format(value);
}

function buildPeriodLabels(startDate: string, horizon: number, freq: "day" | "week" | "month") {
  const labels: string[] = [];
  if (!startDate || horizon <= 0) return labels;
  let current = new Date(`${startDate}T00:00:00`);
  for (let i = 0; i < horizon; i += 1) {
    labels.push(labelForDate(current, freq));
    current = incrementDate(current, freq);
  }
  return labels;
}

function incrementDate(value: Date, freq: "day" | "week" | "month") {
  const next = new Date(value);
  if (freq === "day") {
    next.setDate(next.getDate() + 1);
  } else if (freq === "week") {
    next.setDate(next.getDate() + 7);
  } else {
    const month = next.getMonth();
    next.setMonth(month + 1);
  }
  return next;
}

function labelForDate(value: Date, freq: "day" | "week" | "month") {
  if (freq === "day") {
    return value.toISOString().slice(0, 10);
  }
  if (freq === "week") {
    const temp = new Date(value);
    const firstDay = temp.getDate() - temp.getDay() + 1;
    temp.setDate(firstDay);
    const iso = temp.toISOString().slice(0, 10);
    const [year] = iso.split("-");
    const week = getWeekNumber(value);
    return `${year}-W${String(week).padStart(2, "0")}`;
  }
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
}

function sanitizeMultiplierValue(value: number | undefined) {
  const num = Number(value);
  if (!Number.isFinite(num) || Number.isNaN(num)) return DEFAULT_MULTIPLIER;
  if (num < 0) return 0;
  if (num > 1_000_000) return 1_000_000;
  return Number(num);
}

function buildMultipliersFromAdjustments(
  variables: VariableRow[],
  periods: string[],
  adjustments: Record<string, Record<string, PeriodValue>>
): MultipliersMap {
  const result: MultipliersMap = {};
  const periodList = periods.length ? periods : [];
  variables.forEach((variable) => {
    const baseline = Number(variable.baseline_mean ?? 0);
    const periodValues: Record<string, number> = {};
    periodList.forEach((period) => {
      const entry = adjustments[period]?.[variable.name];
      const fallback = DEFAULT_MULTIPLIER;
      if (!entry) {
        periodValues[period] = fallback;
      } else if (entry.mode === "value") {
        const safeBaseline = baseline === 0 ? 1 : baseline;
        periodValues[period] = sanitizeMultiplierValue(entry.value / safeBaseline);
      } else {
        periodValues[period] = sanitizeMultiplierValue(entry.value);
      }
    });
    result[variable.name] = periodValues;
  });
  return result;
}

function multipliersToAdjustments(
  multipliers: MultipliersMap,
  periods: string[],
  variables: VariableRow[],
  absoluteOverrides?: Record<string, Record<string, number>>
): Record<string, Record<string, PeriodValue>> {
  const next: Record<string, Record<string, PeriodValue>> = {};
  const periodList = periods.length ? periods : [];
  periodList.forEach((period) => {
    const mapping: Record<string, PeriodValue> = {};
    variables.forEach((variable) => {
      const value = sanitizeMultiplierValue(multipliers[variable.name]?.[period]);
      const absoluteValue = absoluteOverrides?.[variable.name]?.[period];
      if (typeof absoluteValue === "number" && Number.isFinite(absoluteValue)) {
        mapping[variable.name] = { mode: "value", value: absoluteValue };
      } else {
        mapping[variable.name] = { mode: "multiplier", value };
      }
    });
    next[period] = mapping;
  });
  return next;
}

function buildAbsoluteValuesFromAdjustments(
  variables: VariableRow[],
  periods: string[],
  adjustments: Record<string, Record<string, PeriodValue>>
): Record<string, Record<string, number>> {
  const result: Record<string, Record<string, number>> = {};
  const periodList = periods.length ? periods : [];
  variables.forEach((variable) => {
    const baseline = Number(variable.baseline_mean ?? 0);
    const mapping: Record<string, number> = {};
    periodList.forEach((period) => {
      const entry = adjustments[period]?.[variable.name];
      if (!entry) return;
      if (entry.mode === "value") {
        mapping[period] = roundAbsoluteValue(entry.value);
      } else {
        const multiplier = sanitizeMultiplierValue(entry.value);
        mapping[period] = roundAbsoluteValue(baseline * multiplier);
      }
    });
    result[variable.name] = mapping;
  });
  return result;
}

function roundAbsoluteValue(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(2));
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildExportFilename(base: string, suffix: string) {
  const safe = sanitizeFilenameFragment(base);
  const stamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0];
  return `${safe}-${suffix}-${stamp}.xlsx`;
}

function sanitizeFilenameFragment(value: string) {
  const trimmed = value?.trim() || "scenario";
  const safe = trimmed.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return (safe || "scenario").toLowerCase();
}

function getWeekNumber(date: Date) {
  const target = new Date(date.valueOf());
  const dayNr = (date.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
  }
  return 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
}

function ensureAdjustmentDefaults(
  periods: string[],
  variables: VariableRow[],
  setAdjustments: React.Dispatch<React.SetStateAction<Record<string, Record<string, PeriodValue>>>>
) {
  if (!periods.length || !variables.length) return;
  setAdjustments((prev) => {
    const next: Record<string, Record<string, PeriodValue>> = {};
    periods.forEach((period) => {
      const existing = prev[period] || {};
      const periodValues: Record<string, PeriodValue> = {};
      variables.forEach((variable) => {
        periodValues[variable.name] = existing[variable.name] || { mode: "multiplier", value: 1 };
      });
      next[period] = periodValues;
    });

    const same =
      Object.keys(prev).length === Object.keys(next).length &&
      Object.keys(next).every((period) => {
        const prevVars = prev[period] || {};
        const nextVars = next[period];
        return (
          Object.keys(prevVars).length === Object.keys(nextVars).length &&
          Object.keys(nextVars).every(
            (key) =>
              prevVars[key] &&
              prevVars[key].mode === nextVars[key].mode &&
              Number(prevVars[key].value) === Number(nextVars[key].value)
          )
        );
      });
    return same ? prev : next;
  });
}

function cloneAdjustments(source: Record<string, Record<string, PeriodValue>>) {
  const clone: Record<string, Record<string, PeriodValue>> = {};
  Object.entries(source || {}).forEach(([period, mapping]) => {
    clone[period] = {};
    Object.entries(mapping || {}).forEach(([variable, value]) => {
      clone[period][variable] = { ...value };
    });
  });
  return clone;
}

function buildBaselineAdjustments(periods: string[], variables: VariableRow[]) {
  const result: Record<string, Record<string, PeriodValue>> = {};
  periods.forEach((period) => {
    const mapping: Record<string, PeriodValue> = {};
    variables.forEach((variable) => {
      mapping[variable.name] = { mode: "multiplier", value: 1 };
    });
    result[period] = mapping;
  });
  return result;
}




