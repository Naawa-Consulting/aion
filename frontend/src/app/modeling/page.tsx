"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Bar, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend, ComposedChart } from "recharts";
import { toast } from "sonner";

import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SelectedPredictorsQuickView } from "@/components/modeling/SelectedPredictorsQuickView";

type Dataset = { id: string; display_name: string; columns: { name: string; dtype: string }[] };
type Variable = { id: string; name: string; dtype: string };
type CorrelationItem = {
  name: string;
  corr_y: number | null;
  corr_res: number | null;
  dtype: string;
  derived: boolean;
  group_name: string | null;
  subgroup_name: string | null;
};
type ModelMetrics = {
  r2: number;
  adj_r2: number;
  durbin_watson: number;
  mae: number;
  rmse: number;
  mape?: number | null;
  vif: { name: string; vif: number }[];
};
type Model = {
  id: string;
  name: string;
  dataset_id: string;
  y_var: string;
  x_vars: string[];
  is_hero: boolean;
  role: "hero" | "challenger1" | "challenger2" | "none";
  metrics: ModelMetrics;
};
type ModelSummary = {
  model_id: string;
  intercept: Coefficient;
  coefficients: Coefficient[];
};
type Coefficient = {
  name: string;
  coef: number;
  std_err: number;
  t_value: number;
  p_value: number;
  vif?: number | null;
  beta_std?: number | null;
};
type Predictions = {
  index: string[];
  y_true: number[];
  y_pred: number[];
  residuals: number[];
};

type GroupFilter = "all" | string;
type SubgroupFilter = "all" | string;

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const formatPValue = (value: number) => {
  if (value == null || Number.isNaN(value)) return "-";
  return value < 0.0001 ? "<0.0001" : value.toFixed(4);
};

const formatCorr = (value: number | null | undefined) => {
  if (value == null || Number.isNaN(value)) return "-";
  return value.toFixed(3);
};

const formatTimeLabel = (value: string | number, includeYear = true) => {
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
    if (includeYear) {
      options.year = "numeric";
    }
    return parsed.toLocaleDateString(undefined, options);
  }
  return value;
};

export default function ModelingPage() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedDataset, setSelectedDataset] = useState<string>("");
  const [variables, setVariables] = useState<Variable[]>([]);
  const [yVar, setYVar] = useState("");
  const [xSelected, setXSelected] = useState<string[]>([]);
  const [modelName, setModelName] = useState("");
  const [corr, setCorr] = useState<CorrelationItem[]>([]);
  const [corrSearch, setCorrSearch] = useState("");
  const [models, setModels] = useState<Model[]>([]);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [summary, setSummary] = useState<ModelSummary | null>(null);
  const [predictions, setPredictions] = useState<Predictions | null>(null);
  const [showResiduals, setShowResiduals] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showQuickView, setShowQuickView] = useState(false);
  const [groupFilter, setGroupFilter] = useState<GroupFilter>("all");
  const [subgroupFilter, setSubgroupFilter] = useState<SubgroupFilter>("all");

  useEffect(() => {
    fetchDatasets();
  }, []);

  useEffect(() => {
    if (selectedDataset) {
      fetchVariables(selectedDataset);
      fetchModels(selectedDataset);
    }
  }, [selectedDataset]);

  useEffect(() => {
    setGroupFilter("all");
    setSubgroupFilter("all");
  }, [selectedDataset]);

  useEffect(() => {
    if (selectedDataset && yVar) {
      fetchCorrelations(selectedDataset, yVar, editingModelId);
    }
  }, [selectedDataset, yVar, editingModelId]);

  useEffect(() => {
    const hero = models.find((m) => m.role === "hero");
    if (hero) {
      fetchSummary(hero.id);
      fetchPredictions(hero.id);
    } else {
      setSummary(null);
      setPredictions(null);
    }
  }, [models]);

  const fetchDatasets = async () => {
    try {
      const res = await fetch(`${API_URL}/datasets`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setDatasets(data);
      if (!selectedDataset && data.length) {
        setSelectedDataset(data[0].id);
      }
    } catch {
      toast.error("Failed to load datasets");
    }
  };

  const fetchVariables = async (datasetId: string) => {
    try {
      const res = await fetch(`${API_URL}/variables?dataset_id=${datasetId}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      const mapped: Variable[] = data.map((v: any) => ({ id: v.id, name: v.name, dtype: v.dtype }));
      setVariables(mapped);
      const numeric = mapped.find((v) => /int|float|double|decimal|number/i.test(v.dtype));
      if (!yVar && numeric) setYVar(numeric.name);
    } catch {
      toast.error("Failed to load variables");
    }
  };

  const fetchModels = async (datasetId: string) => {
    try {
      const res = await fetch(`${API_URL}/models?dataset_id=${datasetId}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setModels(data);
    } catch {
      toast.error("Failed to load models");
    }
  };

  const fetchCorrelations = async (datasetId: string, y: string, modelId?: string | null) => {
    try {
      const params = new URLSearchParams({ dataset_id: datasetId, y: y });
      if (modelId) {
        params.append("model_id", modelId);
      }
      const res = await fetch(`${API_URL}/models/correlations?${params.toString()}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setCorr(data.items);
    } catch {
      toast.error("Failed to compute correlations");
    }
  };

  const fetchSummary = async (modelId: string) => {
    try {
      const res = await fetch(`${API_URL}/models/${modelId}/summary`);
      if (!res.ok) throw new Error();
      setSummary(await res.json());
    } catch {
      setSummary(null);
    }
  };

  const fetchPredictions = async (modelId: string) => {
    try {
      const res = await fetch(`${API_URL}/models/${modelId}/predictions?granularity=auto`);
      if (!res.ok) throw new Error();
      setPredictions(await res.json());
    } catch {
      setPredictions(null);
    }
  };

  const handleToggleX = (name: string) => {
    setXSelected((prev) => (prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name]));
  };

  const handleToggleSelectAll = () => {
    if (!visibleCorrelations.length) return;
    setXSelected((prev) => {
      if (allVisibleSelected) {
        return prev.filter((name) => !visibleCorrelations.some((item) => item.name === name));
      }
      const merged = new Set(prev);
      visibleCorrelations.forEach((item) => merged.add(item.name));
      return Array.from(merged);
    });
  };

  const selectedDetails = useMemo(
    () =>
      xSelected.map((name) => {
        const meta = corr.find((item) => item.name === name);
        return { name, corr_y: meta?.corr_y ?? null, corr_res: meta?.corr_res ?? null };
      }),
    [xSelected, corr]
  );

  const handleSubmit = async () => {
    if (!selectedDataset || !yVar || xSelected.length === 0 || !modelName.trim()) {
      toast.error("Provide a name, target, and predictors");
      return;
    }
    setLoading(true);
    try {
      if (editingModelId) {
        const res = await fetch(`${API_URL}/models/${editingModelId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: modelName, x_vars: xSelected }),
        });
        if (!res.ok) throw new Error(await res.text());
        toast.success("Model updated");
      } else {
        const res = await fetch(`${API_URL}/models`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dataset_id: selectedDataset, name: modelName, y_var: yVar, x_vars: xSelected }),
        });
        if (!res.ok) throw new Error(await res.text());
        toast.success("Model created");
      }
      await fetchModels(selectedDataset);
      resetForm();
    } catch (err: any) {
      toast.error(err?.message || "Could not save model");
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setModelName("");
    setXSelected([]);
    setEditingModelId(null);
  };

  const startEdit = (model: Model) => {
    setEditingModelId(model.id);
    setModelName(model.name);
    setYVar(model.y_var);
    setXSelected(model.x_vars);
  };

  const deleteModel = async (model: Model) => {
    if (!confirm(`Delete model ${model.name}?`)) return;
    try {
      const res = await fetch(`${API_URL}/models/${model.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      toast.success("Model deleted");
      fetchModels(selectedDataset);
    } catch (err: any) {
      toast.error(err?.message || "Failed to delete");
    }
  };

  const setRole = async (model: Model, role: Model["role"]) => {
    try {
      const res = await fetch(`${API_URL}/models/${model.id}/role`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success(`Marked as ${role}`);
      fetchModels(selectedDataset);
    } catch (err: any) {
      toast.error(err?.message || "Failed to set role");
    }
  };

  const groupOptions = useMemo(() => {
    const names = Array.from(new Set(corr.map((item) => item.group_name).filter((g): g is string => Boolean(g))));
    return names.sort((a, b) => a.localeCompare(b));
  }, [corr]);

  const subgroupOptions = useMemo(() => {
    if (groupFilter === "all") return [];
    const names = Array.from(
      new Set(
        corr
          .filter((item) => item.group_name === groupFilter && item.subgroup_name)
          .map((item) => item.subgroup_name as string)
      )
    );
    return names.sort((a, b) => a.localeCompare(b));
  }, [corr, groupFilter]);

  const visibleCorrelations = useMemo(() => {
    const lowered = corrSearch.toLowerCase();
    return corr
      .filter((item) => item.name.toLowerCase().includes(lowered))
      .filter((item) => {
        if (groupFilter === "all") return true;
        if (item.group_name !== groupFilter) return false;
        if (subgroupFilter === "all") return true;
        return item.subgroup_name === subgroupFilter;
      })
      .sort((a, b) => {
        const aVal = Math.abs(a.corr_y ?? 0);
        const bVal = Math.abs(b.corr_y ?? 0);
        return bVal - aVal;
      });
  }, [corr, corrSearch, groupFilter, subgroupFilter]);

  const allVisibleSelected = useMemo(() => {
    if (!visibleCorrelations.length) return false;
    return visibleCorrelations.every((item) => xSelected.includes(item.name));
  }, [visibleCorrelations, xSelected]);

  const selectAllRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (selectAllRef.current) {
      const someVisibleSelected = visibleCorrelations.some((item) => xSelected.includes(item.name));
      selectAllRef.current.indeterminate = someVisibleSelected && !allVisibleSelected;
    }
  }, [visibleCorrelations, xSelected, allVisibleSelected]);

  const heroModel = models.find((m) => m.role === "hero");
  const challenger1 = models.find((m) => m.role === "challenger1");
  const challenger2 = models.find((m) => m.role === "challenger2");
  const compareModels = [heroModel, challenger1, challenger2].filter(Boolean) as Model[];
  const heroComparisonIndex = compareModels.findIndex((m) => m.role === "hero");

  const formatMetricValue = (value: number | null) => {
    if (value == null || Number.isNaN(value)) return "-";
    if (Math.abs(value) >= 1000) return value.toFixed(0);
    if (Math.abs(value) >= 100) return value.toFixed(1);
    if (Math.abs(value) >= 1) return value.toFixed(2);
    return value.toFixed(3);
  };

  type MetricConfig = {
    key: string;
    label: string;
    type: "higher" | "lower" | "target";
    target?: number;
    getValue: (model: Model) => number | null;
    format?: (value: number | null) => string;
  };

  const metricConfigs: MetricConfig[] = [
    { key: "r2", label: "R^2", type: "higher", getValue: (m) => m.metrics.r2 },
    { key: "adj_r2", label: "Adj R^2", type: "higher", getValue: (m) => m.metrics.adj_r2 },
    {
      key: "vif_max",
      label: "VIF max",
      type: "lower",
      getValue: (m) => (m.metrics.vif.length ? Math.max(...m.metrics.vif.map((v) => v.vif)) : null),
    },
    {
      key: "vif_mean",
      label: "VIF mean",
      type: "lower",
      getValue: (m) =>
        m.metrics.vif.length
          ? m.metrics.vif.reduce((sum, item) => sum + item.vif, 0) / m.metrics.vif.length
          : null,
    },
    {
      key: "durbin_watson",
      label: "Durbin-Watson",
      type: "target",
      target: 2,
      getValue: (m) => m.metrics.durbin_watson,
    },
    { key: "mae", label: "MAE", type: "lower", getValue: (m) => m.metrics.mae },
    { key: "rmse", label: "RMSE", type: "lower", getValue: (m) => m.metrics.rmse },
    {
      key: "mape",
      label: "MAPE",
      type: "lower",
      getValue: (m) => (m.metrics.mape != null ? m.metrics.mape : null),
      format: (value) => (value == null || Number.isNaN(value) ? "-" : `${value.toFixed(1)}%`),
    },
  ];

  const getBestIndex = (
    values: (number | null)[],
    type: MetricConfig["type"],
    target?: number
  ): number | null => {
    const valid = values
      .map((value, idx) => ({ value, idx }))
      .filter((entry) => entry.value != null && !Number.isNaN(entry.value));
    if (!valid.length) return null;
    if (type === "higher") {
      return valid.reduce((best, curr) => ((curr.value as number) > (best.value as number) ? curr : best)).idx;
    }
    if (type === "target" && typeof target === "number") {
      return valid.reduce(
        (best, curr) =>
          Math.abs((curr.value as number) - target) < Math.abs((best.value as number) - target) ? curr : best
      ).idx;
    }
    return valid.reduce((best, curr) => ((curr.value as number) < (best.value as number) ? curr : best)).idx;
  };

  const metricRows = metricConfigs.map((config) => {
    const values = compareModels.map((model) => config.getValue(model));
    const bestIndex = getBestIndex(values, config.type, config.target);
    return { ...config, values, bestIndex };
  });

  const comparisonChartData = useMemo(
    () =>
      compareModels.map((m) => ({
        model: m.name,
        mae: m.metrics.mae,
        rmse: m.metrics.rmse,
        r2: m.metrics.r2,
      })),
    [compareModels]
  );

  const predictionSeries = useMemo(() => {
    if (!predictions) return [];
    return predictions.index.map((label, idx) => ({
      label,
      y_true: predictions.y_true[idx],
      y_pred: predictions.y_pred[idx],
      residual: predictions.residuals[idx],
    }));
  }, [predictions]);

  return (
    <>
      <section className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm text-[var(--color-muted)]">Module 3</p>
          <h1 className="text-2xl font-semibold tracking-tight">Modeling</h1>
        </div>
        <div className="flex gap-3 items-center">
          <div>
            <label className="text-xs uppercase text-[var(--color-muted)]">Dataset</label>
            <select
              className="ml-2 rounded-full border border-[var(--color-border)] px-4 py-2 bg-transparent"
              value={selectedDataset}
              onChange={(e) => {
                setSelectedDataset(e.target.value);
                resetForm();
              }}
            >
              {datasets.map((ds) => (
                <option key={ds.id} value={ds.id}>
                  {ds.display_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs uppercase text-[var(--color-muted)]">Dependent variable</label>
            <select
              className="ml-2 rounded-full border border-[var(--color-border)] px-4 py-2 bg-transparent"
              value={yVar}
              onChange={(e) => setYVar(e.target.value)}
            >
              <option value="">Select Y</option>
              {variables.map((v) => (
                <option key={v.id} value={v.name}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[360px,1fr]">
        <Card className="space-y-4">
          <CardHeader title="Correlations" subtitle="Choose predictors" />
          <div className="flex flex-wrap gap-2 text-xs">
            <button
              type="button"
              onClick={() => {
                setGroupFilter("all");
                setSubgroupFilter("all");
              }}
              className={clsx(
                "rounded-full border px-2.5 py-1 text-[11px]",
                groupFilter === "all"
                  ? "border-[var(--color-foreground)] bg-[var(--color-foreground)] text-white"
                  : "border-[var(--color-border)] text-[var(--color-muted)] hover:bg-[var(--color-border)]/30"
              )}
            >
              All
            </button>
            {groupOptions.map((group) => (
              <button
                key={group}
                type="button"
                onClick={() => {
                  setGroupFilter(group);
                  setSubgroupFilter("all");
                }}
                className={clsx(
                  "rounded-full border px-2.5 py-1 text-[11px]",
                  groupFilter === group
                    ? "border-[var(--color-foreground)] bg-[var(--color-foreground)] text-white"
                    : "border-[var(--color-border)] text-[var(--color-muted)] hover:bg-[var(--color-border)]/30"
                )}
              >
                {group}
              </button>
            ))}
          </div>
          {groupFilter !== "all" && subgroupOptions.length > 0 && (
            <div className="flex flex-wrap gap-2 text-[11px] text-[var(--color-muted)]">
              <button
                type="button"
                onClick={() => setSubgroupFilter("all")}
                className={clsx(
                  "rounded-full border px-2.5 py-1",
                  subgroupFilter === "all"
                    ? "border-[var(--color-foreground)] bg-[var(--color-foreground)] text-white"
                    : "border-[var(--color-border)] hover:bg-[var(--color-border)]/30"
                )}
              >
                All subgroups
              </button>
              {subgroupOptions.map((subgroup) => (
                <button
                  key={subgroup}
                  type="button"
                  onClick={() => setSubgroupFilter(subgroup)}
                  className={clsx(
                    "rounded-full border px-2.5 py-1",
                    subgroupFilter === subgroup
                      ? "border-[var(--color-foreground)] bg-[var(--color-foreground)] text-white"
                      : "border-[var(--color-border)] hover:bg-[var(--color-border)]/30"
                  )}
                >
                  {subgroup}
                </button>
              ))}
            </div>
          )}
          <Input placeholder="Search variables" value={corrSearch} onChange={(e) => setCorrSearch(e.target.value)} />
          <div className="flex items-center justify-between px-1 text-xs text-[var(--color-muted)]">
            <label className="flex items-center gap-2">
              <input
                ref={selectAllRef}
                type="checkbox"
                className="h-4 w-4 accent-[var(--color-accent)]"
                checked={allVisibleSelected}
                onChange={handleToggleSelectAll}
                disabled={!visibleCorrelations.length}
              />
              <span>Select all (filtered)</span>
            </label>
            <button
              type="button"
              className="rounded-full border border-[var(--color-border)] px-2.5 py-1 text-[11px] text-[var(--color-muted)] hover:bg-[var(--color-border)]/30"
              onClick={() => setShowQuickView(true)}
            >
              Selected: {xSelected.length}
            </button>
          </div>
          <div className="h-[420px] overflow-y-auto pr-2">
            <div className="space-y-2">
              {visibleCorrelations.map((item) => (
                <label key={item.name} className="flex items-center justify-between gap-4 text-sm">
                  <div className="min-w-0">
                    <p className="truncate text-[var(--color-foreground)]">{item.name}</p>
                    <p className="text-xs text-[var(--color-muted)]">
                      Y: {formatCorr(item.corr_y)}
                      {editingModelId ? <> | res: {formatCorr(item.corr_res)}</> : null}
                    </p>
                  </div>
                  <input type="checkbox" checked={xSelected.includes(item.name)} onChange={() => handleToggleX(item.name)} />
                </label>
              ))}
              {!visibleCorrelations.length && (
                <p className="text-sm text-[var(--color-muted)]">No predictors match your current filters.</p>
              )}
            </div>
          </div>
        </Card>

        <div className="space-y-6">
          <Card className="space-y-4">
            <CardHeader title={editingModelId ? "Edit model" : "Create model"} subtitle="Select variables and save" />
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-xs uppercase text-[var(--color-muted)]">Model name</label>
                <Input value={modelName} onChange={(e) => setModelName(e.target.value)} placeholder="Hero Model" />
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase text-[var(--color-muted)]">Predictors selected</label>
                <p className="text-sm text-[var(--color-muted)]">
                  {xSelected.length ? `${xSelected.length} selected` : "None yet"}
                </p>
              </div>
            </div>
            <SelectedPredictorsQuickView
              predictors={xSelected}
              onRemove={(name) => setXSelected((prev) => prev.filter((p) => p !== name))}
              onClear={() => setXSelected([])}
            />
            <div className="flex gap-2 justify-end">
              {editingModelId && (
                <Button variant="ghost" onClick={resetForm}>
                  Cancel
                </Button>
              )}
              <Button onClick={handleSubmit} disabled={loading}>
                {loading ? "Saving..." : editingModelId ? "Update model" : "Create model"}
              </Button>
            </div>
          </Card>

          <Card className="space-y-4">
            <CardHeader title="Models" subtitle="Manage hero and challengers" />
            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-[var(--color-bg)]/70">
                  <tr>
                    <th className="px-3 py-2 text-left">Name</th>
                    <th className="px-3 py-2 text-left">Role</th>
                    <th className="px-3 py-2 text-left">R^2</th>
                    <th className="px-3 py-2 text-left">Adj R^2</th>
                    <th className="px-3 py-2 text-left">MAE</th>
                    <th className="px-3 py-2 text-left">RMSE</th>
                    <th className="px-3 py-2 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {models.map((m) => (
                    <tr key={m.id} className="odd:bg-transparent even:bg-[var(--color-border)]/20">
                      <td className="px-3 py-2 font-medium">{m.name}</td>
                      <td className="px-3 py-2">
                        <Badge>{m.role === "none" ? "-" : m.role}</Badge>
                      </td>
                      <td className="px-3 py-2">{m.metrics.r2.toFixed(3)}</td>
                      <td className="px-3 py-2">{m.metrics.adj_r2.toFixed(3)}</td>
                      <td className="px-3 py-2">{m.metrics.mae.toFixed(2)}</td>
                      <td className="px-3 py-2">{m.metrics.rmse.toFixed(2)}</td>
                      <td className="px-3 py-2 space-x-2">
                        <Button variant="ghost" size="sm" onClick={() => startEdit(m)}>
                          Edit
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => deleteModel(m)}>
                          Delete
                        </Button>
                        {m.role !== "hero" && (
                          <Button variant="secondary" size="sm" onClick={() => setRole(m, "hero")}>
                            Hero
                          </Button>
                        )}
                        {m.role !== "challenger1" && (
                          <Button variant="secondary" size="sm" onClick={() => setRole(m, "challenger1")}>
                            Ch. 1
                          </Button>
                        )}
                        {m.role !== "challenger2" && (
                          <Button variant="secondary" size="sm" onClick={() => setRole(m, "challenger2")}>
                            Ch. 2
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>

      <Card className="space-y-4">
        <CardHeader title="Comparison" subtitle="Hero vs Challengers" />
        {compareModels.length ? (
          <>
            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-[var(--color-bg)]/70">
                  <tr>
                    <th className="px-3 py-2 text-left text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
                      Metric
                    </th>
                    {compareModels.map((m, idx) => (
                      <th
                        key={m.id}
                        className={`px-3 py-2 text-center text-xs font-medium ${
                          idx === heroComparisonIndex ? "bg-[var(--color-border)]/30 rounded-t-md" : ""
                        }`}
                      >
                        <div className="flex flex-col items-center gap-1">
                          <span className="text-sm text-[var(--color-foreground)]">{m.name}</span>
                          {m.role === "hero" && (
                            <span className="rounded-full bg-[var(--color-foreground)] px-2 py-0.5 text-[10px] font-semibold text-white">
                              Hero
                            </span>
                          )}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {metricRows.map((row) => (
                    <tr key={row.key} className="odd:bg-transparent even:bg-[var(--color-border)]/20">
                      <td className="px-3 py-2 text-xs font-medium text-[var(--color-muted)]">{row.label}</td>
                      {row.values.map((value, idx) => {
                        const isBest = row.bestIndex != null && idx === row.bestIndex;
                        const isHero = idx === heroComparisonIndex;
                        const cellClasses = [
                          "px-3 py-2 text-center text-sm transition-colors",
                          isHero ? "bg-[var(--color-border)]/20" : "",
                          isBest ? "bg-emerald-50 text-emerald-700 font-semibold rounded-md" : "",
                        ]
                          .filter(Boolean)
                          .join(" ");
                        const displayValue = row.format ? row.format(value) : formatMetricValue(value);
                        return (
                          <td key={`${row.key}-${idx}`} className={cellClasses}>
                            <div className="inline-flex items-center gap-1">
                              <span>{displayValue}</span>
                              {isBest && (
                                <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium">
                                  Best
                                </span>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {comparisonChartData.length > 0 ? (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={comparisonChartData} margin={{ top: 10, right: 32, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="model" stroke="var(--color-muted)" />
                    <YAxis yAxisId="left" axisLine={false} tickLine={false} stroke="var(--color-muted)" />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      domain={[0, 1]}
                      axisLine={false}
                      tickLine={false}
                      stroke="var(--color-muted)"
                    />
                    <Tooltip
                      formatter={(value: number | null, name) => {
                        if (value == null || Number.isNaN(value)) return ["-", name];
                        const decimals = name === "R^2" ? 3 : value < 1 ? 4 : 2;
                        return [value.toFixed(decimals), name];
                      }}
                    />
                    <Legend />
                    <Bar
                      yAxisId="left"
                      dataKey="mae"
                      name="MAE"
                      barSize={18}
                      radius={[6, 6, 0, 0]}
                      fill="#a5b4fc"
                    />
                    <Bar
                      yAxisId="left"
                      dataKey="rmse"
                      name="RMSE"
                      barSize={18}
                      radius={[6, 6, 0, 0]}
                      fill="#c7d2fe"
                    />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="r2"
                      name="R^2"
                      dot={false}
                      stroke="#2563eb"
                      strokeWidth={2}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-[var(--color-muted)]">
            Set a hero and at least one challenger model to compare performance.
          </p>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-4">
          <CardHeader title="Hero Model Summary" subtitle="Coefficients & diagnostics" />
          {summary ? (
            <div className="overflow-auto max-h-[360px] pr-2">
              <table className="min-w-full text-sm">
                <thead className="bg-[var(--color-bg)]/70">
                  <tr>
                    <th className="px-3 py-2 text-left">Variable</th>
                    <th className="px-3 py-2 text-left">Beta</th>
                    <th className="px-3 py-2 text-left">Std Beta</th>
                    <th className="px-3 py-2 text-left">Std Err</th>
                    <th className="px-3 py-2 text-left">t</th>
                    <th className="px-3 py-2 text-left">p</th>
                    <th className="px-3 py-2 text-left">VIF</th>
                  </tr>
                </thead>
                <tbody>
                  {[summary.intercept, ...summary.coefficients].map((item) => (
                    <tr key={item.name} className="odd:bg-transparent even:bg-[var(--color-border)]/20">
                      <td className="px-3 py-2">{item.name}</td>
                      <td className="px-3 py-2">{item.coef.toFixed(4)}</td>
                      <td className="px-3 py-2">{item.beta_std != null ? item.beta_std.toFixed(3) : "-"}</td>
                      <td className="px-3 py-2">{item.std_err.toFixed(4)}</td>
                      <td className="px-3 py-2">{item.t_value.toFixed(2)}</td>
                      <td className="px-3 py-2">{formatPValue(item.p_value)}</td>
                      <td className="px-3 py-2">{item.vif != null ? item.vif.toFixed(2) : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-[var(--color-muted)]">Select a Hero model to view details.</p>
          )}
        </Card>

        <Card className="space-y-4">
          <div className="flex items-center justify-between">
            <CardHeader title="Actual vs Model" subtitle="Toggle residuals for diagnostics" />
            <label className="text-xs flex items-center gap-2">
              <input type="checkbox" checked={showResiduals} onChange={(e) => setShowResiduals(e.target.checked)} />
              Residuals
            </label>
          </div>
          {predictionSeries.length ? (
            <div className="h-72">
              <ResponsiveContainer>
                <LineChart data={predictionSeries}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="label"
                    tickFormatter={(value) => formatTimeLabel(String(value), true)}
                    minTickGap={12}
                    height={40}
                    tick={{ fontSize: 11 }}
                  />
                  <YAxis />
                  <Tooltip
                    labelFormatter={(value) => formatTimeLabel(String(value), true)}
                    formatter={(value: number | string, name) => {
                      if (typeof value === "number") {
                        return [value.toFixed(4), name];
                      }
                      return [value, name];
                    }}
                  />
                  <Legend />
                  {showResiduals ? (
                    <Line type="monotone" dataKey="residual" stroke="#ef4444" dot={false} name="Residual" />
                  ) : (
                    <>
                      <Line type="monotone" dataKey="y_true" stroke="#2563eb" dot={false} name="Actual" />
                      <Line type="monotone" dataKey="y_pred" stroke="#22c55e" dot={false} name="Model" />
                    </>
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-[var(--color-muted)]">No prediction data yet.</p>
          )}
        </Card>
      </div>
    </section>

    {showQuickView && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
        <div className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-[var(--color-foreground)]">Selected predictors</h3>
                <p className="text-xs text-[var(--color-muted)]">{xSelected.length} total</p>
              </div>
              <button
                type="button"
                className="text-xs text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
                onClick={() => setShowQuickView(false)}
              >
                Close
              </button>
            </div>
            <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
              {selectedDetails.length ? (
                selectedDetails.map((item) => (
                  <div
                    key={item.name}
                    className="flex items-center justify-between rounded-xl border border-[var(--color-border)] px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[var(--color-foreground)]">{item.name}</p>
                      <p className="text-xs text-[var(--color-muted)]">
                        Y: {formatCorr(item.corr_y)}
                        {editingModelId ? <> | res: {formatCorr(item.corr_res)}</> : null}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="rounded-full bg-[var(--color-border)] px-2 py-0.5 text-xs text-[var(--color-muted)] hover:bg-[var(--color-border)]/70"
                      onClick={() => handleToggleX(item.name)}
                    >
                      remove
                    </button>
                  </div>
                ))
              ) : (
                <p className="text-sm text-[var(--color-muted)]">No predictors selected.</p>
              )}
            </div>
        </div>
      </div>
    )}
    </>
  );
}





