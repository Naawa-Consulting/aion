"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Dataset = { id: string; display_name: string; columns: { name: string; dtype: string }[] };
type Model = { id: string; name: string; dataset_id: string; role?: string; is_hero: boolean };

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

  const numberFormatter = useMemo(
    () => new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    []
  );

  const periodLabels = useMemo(() => buildPeriodLabels(startDate, horizon, freq), [startDate, horizon, freq]);
  const displayPeriods = preview?.periods?.length ? preview.periods : periodLabels;

  useEffect(() => {
    fetchDatasets();
  }, []);

  useEffect(() => {
    if (selectedDataset) {
      fetchModels(selectedDataset);
    }
  }, [selectedDataset]);

  useEffect(() => {
    if (!selectedModel) return;
    fetchBaselineVariables(selectedModel);
    fetchScenarios(selectedModel);
  }, [selectedModel]);

  useEffect(() => {
    ensureAdjustmentDefaults(periodLabels, variables, setAdjustments);
  }, [periodLabels, variables]);

  const fetchDatasets = async () => {
    try {
      const res = await fetch(`${API_URL}/datasets`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setDatasets(data);
      if (!selectedDataset && data.length) setSelectedDataset(data[0].id);
    } catch {
      toast.error("Failed to load datasets");
    }
  };

  const fetchModels = async (datasetId: string) => {
    try {
      const res = await fetch(`${API_URL}/models?dataset_id=${datasetId}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setModels(data);
      const hero = data.find((m: any) => m.role === "hero" || m.is_hero) || data[0];
      if (hero) setSelectedModel(hero.id);
    } catch {
      toast.error("Failed to load models");
    }
  };

  const fetchBaselineVariables = async (modelId: string) => {
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
  };

  const fetchScenarios = async (modelId: string) => {
    try {
      const res = await fetch(`${API_URL}/predict/scenarios?model_id=${modelId}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setScenarios(data);
    } catch {
      toast.error("Failed to load scenarios");
    }
  };

  const fetchPreview = useCallback(async () => {
    if (!selectedModel) return;
    setPreviewLoading(true);
    try {
      const payload = {
        model_id: selectedModel,
        horizon,
        start_date: startDate,
        freq,
        adjustments,
      };
      const res = await fetch(`${API_URL}/predict/scenarios/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      const data: ScenarioSummary = await res.json();
      setPreview(data);
    } catch (error: any) {
      toast.error(error?.message || "Preview failed");
    } finally {
      setPreviewLoading(false);
    }
  }, [selectedModel, horizon, startDate, freq, adjustments]);

  const handleAdjustmentChange = (period: string, variable: string, mode: PeriodValue["mode"], value: number) => {
    setAdjustments((prev) => {
      const next = { ...prev };
      const periodMap = { ...(next[period] || {}) };
      periodMap[variable] = { mode, value };
      next[period] = periodMap;
      return next;
    });
  };

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

  const topGroups = preview?.groups?.slice(0, 3) || [];
  const chartSeries = preview?.series || [];

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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card padding="sm">
          <CardHeader title="Projected total" subtitle="Y forecast" />
          <p className="text-lg font-semibold">{preview ? formatNumber(numberFormatter, preview.total) : "–"}</p>
        </Card>
        <Card padding="sm">
          <CardHeader title="Average per period" subtitle={freq} />
          <p className="text-lg font-semibold">
            {preview ? formatNumber(numberFormatter, preview.average_per_period) : "–"}
          </p>
        </Card>
        {topGroups.map((group) => (
          <Card key={group.id || group.name} padding="sm">
            <CardHeader title={group.name || "Group"} subtitle="Contribution" />
            <p className="text-lg font-semibold">{formatNumber(numberFormatter, group.value)}</p>
          </Card>
        ))}
      </div>

      <Card className="space-y-4">
        <CardHeader title="Scenario builder" subtitle="Edit multipliers by period and variable" />
        {variables.length ? (
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-[var(--color-bg)]/60">
                <tr>
                  <th className="px-3 py-2 text-left">Variable</th>
                  <th className="px-3 py-2 text-left">Baseline mean</th>
                  {displayPeriods.map((period) => (
                    <th key={period} className="px-3 py-2 text-left whitespace-nowrap">
                      {period}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {variables.map((variable) => (
                  <tr key={variable.name} className="odd:bg-transparent even:bg-[var(--color-border)]/20">
                    <td className="px-3 py-2">{variable.name}</td>
                    <td className="px-3 py-2">{formatNumber(numberFormatter, variable.baseline_mean)}</td>
                    {displayPeriods.map((period) => {
                      const entry = adjustments[period]?.[variable.name];
                      const mode = entry?.mode || "multiplier";
                      const value = entry?.value ?? 1;
                      return (
                        <td key={`${period}-${variable.name}`} className="px-3 py-2">
                          <div className="flex items-center gap-1">
                            <select
                              className="rounded-md border border-[var(--color-border)] bg-transparent px-2 py-1 text-xs"
                              value={mode}
                              onChange={(e) =>
                                handleAdjustmentChange(period, variable.name, e.target.value as PeriodValue["mode"], value)
                              }
                            >
                              <option value="multiplier">×</option>
                              <option value="value">Value</option>
                            </select>
                            <input
                              type="number"
                              step={mode === "multiplier" ? 0.1 : 1}
                              className="w-24 rounded-md border border-[var(--color-border)] bg-transparent px-2 py-1"
                              value={value}
                              onChange={(e) =>
                                handleAdjustmentChange(period, variable.name, mode, Number(e.target.value) || 0)
                              }
                            />
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-[var(--color-muted)]">Select a model to load variables.</p>
        )}
      </Card>

      <Card className="space-y-4">
        <CardHeader title="Projected totals" subtitle="Hero vs scenario" />
        {chartSeries.length ? (
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-[var(--color-bg)]/60">
                <tr>
                  <th className="px-3 py-2 text-left">Period</th>
                  <th className="px-3 py-2 text-left">Projected Y</th>
                </tr>
              </thead>
              <tbody>
                {chartSeries.map((point) => (
                  <tr key={point.period} className="odd:bg-transparent even:bg-[var(--color-border)]/20">
                    <td className="px-3 py-2">{point.period}</td>
                    <td className="px-3 py-2">{formatNumber(numberFormatter, point.y_pred)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-[var(--color-muted)]">Preview the scenario to see projections.</p>
        )}
      </Card>

      <Card className="space-y-4">
        <CardHeader title="Saved scenarios" subtitle="Load, compare or delete (max 3)" />
        {scenarios.length ? (
          <div className="grid gap-4 md:grid-cols-3">
            {scenarios.map((scenario) => (
              <Card key={scenario.id} className={`space-y-2 ${selectedScenario === scenario.id ? "border-[var(--color-accent)]" : ""}`}>
                <CardHeader title={scenario.name} subtitle={`${scenario.horizon} periods · ${scenario.freq}`} />
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
  if (value === null || value === undefined || Number.isNaN(value)) return "–";
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
