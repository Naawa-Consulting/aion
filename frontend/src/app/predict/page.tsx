"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from "recharts";
import { toast } from "sonner";

import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import ScenarioGrid, { type MultipliersMap } from "@/components/predict/ScenarioGrid";

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
  name: string;
  horizon: number;
  start_date: string;
  freq: "day" | "week" | "month";
  adjustments: Record<string, Record<string, PeriodValue>>;
  summary: ScenarioSummary;
};

const DEFAULT_MULTIPLIER = 1;

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function PredictPage() {
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
  const [selectedScenario, setSelectedScenario] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editMode, setEditMode] = useState<"multipliers" | "absolute">("multipliers");
  const [heroSeries, setHeroSeries] = useState<ScenarioSeriesPoint[]>([]);
  const [heroLoading, setHeroLoading] = useState(false);
  const [showProjectedTable, setShowProjectedTable] = useState(false);

  const numberFormatter = useMemo(
    () => new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    []
  );
  const percentFormatter = useMemo(
    () => new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    []
  );

  const periodLabels = useMemo(() => buildPeriodLabels(startDate, horizon, freq), [startDate, horizon, freq]);
  const displayPeriods = preview?.periods?.length ? preview.periods : periodLabels;
  const editablePeriods = displayPeriods.length ? displayPeriods : periodLabels;
  const gridVariables = useMemo(
    () => variables.map((variable) => ({ name: variable.name, baselineMean: variable.baseline_mean })),
    [variables]
  );
  const multipliersByVariable = useMemo(
    () => buildMultipliersFromAdjustments(variables, editablePeriods, adjustments),
    [variables, editablePeriods, adjustments]
  );
  const selectedModelInfo = useMemo(
    () => models.find((model) => model.id === selectedModel),
    [models, selectedModel]
  );
  const dependentLabel = selectedModelInfo?.y_var ?? "Y";
  const freqLabel = freq === "day" ? "day" : freq === "week" ? "week" : "month";

  const fetchDatasets = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/datasets`);
      if (!res.ok) throw new Error();
      const data = await res.json();
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
      const res = await fetch(`${API_URL}/models?dataset_id=${datasetId}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
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
      const res = await fetch(`${API_URL}/predict/scenarios/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      const data: ScenarioSummary = await res.json();
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
      const res = await fetch(`${API_URL}/predict/${modelId}/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adjustments: [] }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setVariables(data.variables || []);
      fetchPreview();
    } catch {
      toast.error("Failed to load baseline variables");
    }
  }, [fetchPreview]);

  const fetchScenarios = useCallback(async (modelId: string) => {
    try {
      const res = await fetch(`${API_URL}/predict/scenarios?model_id=${modelId}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
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
    if (!selectedModel) return;
    fetchBaselineVariables(selectedModel);
    fetchScenarios(selectedModel);
  }, [selectedModel, fetchBaselineVariables, fetchScenarios]);

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
    (nextMultipliers: MultipliersMap) => {
      setAdjustments(multipliersToAdjustments(nextMultipliers, editablePeriods, variables));
    },
    [editablePeriods, variables]
  );
  const handleResetAll = useCallback(() => {
    if (!window.confirm("Reset scenario to baseline? This will overwrite all current adjustments.")) return;
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
  }, [editablePeriods, variables]);

  const handleSaveScenario = async () => {
    if (!selectedModel) {
      toast.error("Select a model first");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/predict/scenarios`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model_id: selectedModel,
          name: scenarioName || "Scenario",
          horizon,
          start_date: startDate,
          freq,
          adjustments,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success("Scenario saved");
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
    setSelectedScenario(scenario.id);
    setPreview(scenario.summary);
  };

  const handleDeleteScenario = async (scenarioId: string) => {
    try {
      const res = await fetch(`${API_URL}/predict/scenarios/${scenarioId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      toast.success("Scenario deleted");
      if (selectedScenario === scenarioId) setSelectedScenario(null);
      if (selectedModel) fetchScenarios(selectedModel);
    } catch (error: any) {
      toast.error(error?.message || "Unable to delete scenario");
    }
  };

  const scenarioSeries = useMemo(() => preview?.series ?? [], [preview?.series]);
  const groups = preview?.groups ?? [];
  const baselineContribution =
    groups.find((group) => group.id === "baseline" || group.name?.toLowerCase() === "baseline")?.value ?? 0;
  const marketingContribution = groups
    .filter((group) => group.name && group.name.toLowerCase().includes("marketing"))
    .reduce((sum, group) => sum + group.value, 0);
  const otherContribution = groups
    .filter((group) => !group.id && (!group.name || group.name.toLowerCase() === "other"))
    .reduce((sum, group) => sum + group.value, 0);
  const projectedTotal = preview?.total ?? null;
  const marketingPercent = projectedTotal ? (marketingContribution / projectedTotal) * 100 : 0;
  const otherPercent = projectedTotal ? (otherContribution / projectedTotal) * 100 : 0;
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
  const handleExportTimeseries = useCallback(() => {
    if (!chartData.length) return;
    const rows = chartData.map((row) => `${row.period},${row.hero ?? ""},${row.scenario ?? ""}`);
    const csv = ["Period,Hero,Scenario", ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `projected_totals_${dependentLabel}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [chartData, dependentLabel]);

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
        <div className="flex gap-3">
          <Button onClick={fetchPreview} disabled={previewLoading || !selectedModel}>
            {previewLoading ? "Recalculating..." : "Preview scenario"}
          </Button>
          <Button variant="secondary" onClick={handleSaveScenario} disabled={saving || !selectedModel}>
            {saving ? "Saving..." : "Save scenario"}
          </Button>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card padding="sm">
          <CardHeader title="Projected total" subtitle={`Forecast: ${dependentLabel}`} />
          <p className="text-lg font-semibold">
            {preview ? formatNumber(numberFormatter, preview.total) : "-"}
          </p>
        </Card>
        <Card padding="sm">
          <CardHeader title="Average per period" subtitle={freqLabel} />
          <p className="text-lg font-semibold">
            {preview ? formatNumber(numberFormatter, preview.average_per_period) : "-"}
          </p>
        </Card>
        <Card padding="sm">
          <CardHeader title="Baseline" subtitle="Intercept + non-marketing" />
          <p className="text-lg font-semibold">
            {preview ? formatNumber(numberFormatter, baselineContribution) : "-"}
          </p>
        </Card>
        <Card padding="sm">
          <CardHeader title="Marketing" subtitle="Sum of marketing contributions" />
          <p className="text-lg font-semibold">
            {preview ? formatNumber(numberFormatter, marketingContribution) : "-"}
          </p>
          <p className="text-xs text-[var(--color-muted)]">
            {preview && projectedTotal ? `${percentFormatter.format(marketingPercent)}% of total` : "-"}
          </p>
        </Card>
        <Card padding="sm">
          <CardHeader title="Other" subtitle="Residual / ungrouped" />
          <p className="text-lg font-semibold">
            {preview ? formatNumber(numberFormatter, otherContribution) : "-"}
          </p>
          <p className="text-xs text-[var(--color-muted)]">
            {preview && projectedTotal ? `${percentFormatter.format(otherPercent)}% of total` : "-"}
          </p>
        </Card>
      </div>

      <Card className="space-y-4">
        <CardHeader title="Scenario builder" subtitle="Edit multipliers by period and variable" />
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <div className="inline-flex rounded-full border border-[var(--color-border)] bg-[var(--color-bg)] p-0.5">
            <button
              type="button"
              onClick={() => setEditMode("multipliers")}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                editMode === "multipliers" ? "bg-[var(--color-foreground)] text-white shadow" : "text-[var(--color-muted)]"
              }`}
            >
              Multipliers
            </button>
            <button
              type="button"
              onClick={() => setEditMode("absolute")}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                editMode === "absolute" ? "bg-[var(--color-foreground)] text-white shadow" : "text-[var(--color-muted)]"
              }`}
            >
              Absolute values
            </button>
          </div>
          <Button variant="ghost" size="sm" onClick={handleResetAll}>
            Reset scenario to baseline
          </Button>
        </div>
        {variables.length ? (
          <ScenarioGrid
            variables={gridVariables}
            periods={editablePeriods}
            multipliers={multipliersByVariable}
            editMode={editMode}
            onMultipliersChange={handleGridMultipliersChange}
          />
        ) : (
          <p className="text-sm text-[var(--color-muted)]">Select a model to load variables.</p>
        )}
      </Card>

      <Card className="space-y-4">
        <CardHeader title="Projected totals" subtitle="Hero vs scenario" />
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
                    name="Hero"
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
              <Button variant="ghost" size="sm" onClick={handleExportTimeseries} disabled={!chartData.length}>
                Export Excel
              </Button>
            </div>
            {showProjectedTable && (
              <div className="overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-[var(--color-bg)]/60">
                    <tr>
                      <th className="px-3 py-2 text-left">Period</th>
                      <th className="px-3 py-2 text-left">Hero</th>
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
        <CardHeader title="Saved scenarios" subtitle="Load, compare or delete (max 3)" />
        {scenarios.length ? (
          <div className="grid gap-4 md:grid-cols-3">
            {scenarios.map((scenario) => (
              <Card key={scenario.id} className={`space-y-2 ${selectedScenario === scenario.id ? "border-[var(--color-accent)]" : ""}`}>
                <CardHeader title={scenario.name} subtitle={`${scenario.horizon} periods \u2022 ${scenario.freq}`} />
                <div className="px-4 pb-2 text-sm">
                  <p className="text-[var(--color-muted)]">Projected total</p>
                  <p className="text-lg font-semibold">{formatNumber(numberFormatter, scenario.summary.total)}</p>
                </div>
                <div className="flex gap-2 px-4 pb-4">
                  <Button variant="secondary" onClick={() => handleLoadScenario(scenario)}>
                    Load
                  </Button>
                  <Button variant="ghost" onClick={() => handleDeleteScenario(scenario.id)}>
                    Delete
                  </Button>
                </div>
              </Card>
            ))}
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
  if (num > 10) return 10;
  return Number(num.toFixed(3));
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
      if (!entry) {
        periodValues[period] = DEFAULT_MULTIPLIER;
      } else if (entry.mode === "value") {
        if (baseline !== 0) {
          periodValues[period] = sanitizeMultiplierValue(entry.value / baseline);
        } else {
          periodValues[period] = sanitizeMultiplierValue(entry.value);
        }
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
  variables: VariableRow[]
): Record<string, Record<string, PeriodValue>> {
  const next: Record<string, Record<string, PeriodValue>> = {};
  const periodList = periods.length ? periods : [];
  periodList.forEach((period) => {
    const mapping: Record<string, PeriodValue> = {};
    variables.forEach((variable) => {
      const value = sanitizeMultiplierValue(multipliers[variable.name]?.[period]);
      mapping[variable.name] = { mode: "multiplier", value };
    });
    next[period] = mapping;
  });
  return next;
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




